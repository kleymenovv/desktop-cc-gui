//! Public run activity only. Never forward invocation context, tool arguments,
//! raw results, environment, provider traces or unfiltered log records to IPC.
use serde_json::{json, Value};

pub(super) fn run(mut value: Value) -> Value {
    if let Some(fields) = value.as_object_mut() {
        fields.retain(|key, _| ["id", "agentId", "agentName", "adapterType", "runtimeMode", "status", "startedAt", "finishedAt", "createdAt", "currentStatusMessage", "currentToolName", "lastAssistantSnippet", "lastEventAt", "lastOutputAt", "livenessState", "nextAction", "error", "errorCode"].contains(&key.as_str()));
    }
    value
}
fn string(value: &Value, key: &str) -> Option<String> {
    value.get(key).and_then(Value::as_str).filter(|s| !s.is_empty()).map(|s| s.chars().take(32_768).collect())
}

pub(super) fn events(value: Value, after: u64) -> Value {
    let rows = value.as_array().cloned().unwrap_or_default();
    let mut cursor = after;
    let mut projected = Vec::new();
    for event in &rows {
        let seq = event["seq"].as_u64().unwrap_or(0);
        cursor = cursor.max(seq);
        let event_type = event["eventType"].as_str().unwrap_or("");
        let wrapper = &event["payload"];
        let envelope = &wrapper["prpEvent"];
        let payload = if envelope.is_object() { &envelope["payload"] } else { wrapper };
        let item = if payload["item"].is_object() { &payload["item"] } else { payload };
        let raw_kind = string(payload, "kind").or_else(|| string(item, "kind")).or_else(|| string(item, "type")).unwrap_or_default().replace('_', "").to_lowercase();
        let tool = event_type.starts_with("tool.execution.") || ["tooluse", "toolresult", "toolcall", "mcptoolcall", "commandexecution", "dynamictoolcall"].contains(&raw_kind.as_str());
        let kind = if tool { "tool" } else if ["agentmessage", "assistantmessage"].contains(&raw_kind.as_str()) { "message" }
            else if raw_kind == "reasoning" { "reasoning" }
            else if event_type == "item.delta" || event_type == "item.completed" || event_type == "item.started" { "item" }
            else if event["level"] == "error" || event_type.ends_with(".failed") { "error" }
            else if event_type.starts_with("runtime_request.") || event_type == "provider.notice.recorded" || event_type.starts_with("turn.") || event_type == "lifecycle" || event_type == "run.terminal" { "notice" }
            else { continue; };
        let id = string(payload, "executionId").or_else(|| string(item, "tool_use_id")).or_else(|| string(envelope, "itemId")).or_else(|| string(payload, "itemId")).or_else(|| string(item, "id")).unwrap_or_else(|| format!("event-{seq}"));
        let text = if kind == "tool" { None } else { string(payload, "text").or_else(|| string(item, "text")).or_else(|| string(payload, "summary")).or_else(|| string(event, "message")) };
        let failed = item["isError"] == true || item["is_error"] == true || payload["status"] == "failed" || event["level"] == "error" || event_type.ends_with(".failed");
        let completed = event_type.ends_with(".completed") && raw_kind != "tooluse";
        let status = if failed { "failed" } else if completed { "completed" } else { "running" };
        let name = string(item, "name").or_else(|| string(payload, "toolName")).or_else(|| string(payload, "name")).or_else(|| string(&payload["tool"], "name"));
        projected.push(json!({"seq":seq,"itemId":id,"kind":kind,"eventType":event_type,"text":text,"name":name,"status":status,"time":event["createdAt"],"delta":event_type == "item.delta"}));
    }
    json!({"events":projected,"nextSeq":cursor,"hasMore":rows.len() == 200})
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn empty_payload_text_does_not_hide_the_completed_item_body() {
        let page = events(json!([{"seq":1,"eventType":"item.completed","payload":{"prpEvent":{"itemId":"message","payload":{"kind":"agentMessage","text":"","item":{"text":"Completed body"}}}}}]),0);
        assert_eq!(page["events"][0]["text"],"Completed body");
    }
    #[test]
    fn preserves_stream_identity_and_cursor_without_tool_secrets() {
        let value = events(json!([
            {"seq":1,"eventType":"run.performance.span","payload":{"secret":"private"}},
            {"seq":2,"eventType":"item.delta","payload":{"prpEvent":{"itemId":"msg","payload":{"kind":"agentMessage","text":"Привет 🙂"}}}},
            {"seq":3,"eventType":"item.completed","payload":{"prpEvent":{"payload":{"item":{"type":"tool_result","tool_use_id":"tool","name":"Read","isError":true,"result":{"secret":"private"},"input":{"token":"private"}}}}}}
        ]), 0);
        assert_eq!(value["nextSeq"],3);
        assert_eq!(value["events"][0]["text"],"Привет 🙂");
        assert_eq!(value["events"][1]["itemId"],"tool");
        assert_eq!(value["events"][1]["status"],"failed");
        assert!(!value.to_string().contains("private"));
    }
    #[test]
    fn run_projection_never_discloses_context_or_raw_logs() {
        let value = run(json!({"id":"run","status":"running","currentToolName":"Read","contextSnapshot":{"secret":"private"},"stdoutExcerpt":"private","resultJson":{"secret":"private"}}));
        assert_eq!(value["currentToolName"],"Read");
        assert!(!value.to_string().contains("private"));
    }
}
