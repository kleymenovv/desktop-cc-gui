//! Shared, presentation-only wire format between the driver and GUI.
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct TargetBounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl TargetBounds {
    pub fn valid(&self) -> bool {
        [self.x, self.y, self.width, self.height]
            .iter()
            .all(|v| v.is_finite())
            && self.width > 0.0
            && self.height > 0.0
            && self.width <= 32_768.0
            && self.height <= 32_768.0
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ActionPreview {
    pub kind: String,
    #[serde(default)]
    pub agent_id: Option<String>,
    pub x: f64,
    pub y: f64,
    #[serde(default)]
    pub bounds: Option<TargetBounds>,
    #[serde(default)]
    pub label: String,
    #[serde(default)]
    pub keys: Option<String>,
    #[serde(default)]
    pub text_length: Option<usize>,
}

impl ActionPreview {
    pub fn new(kind: &str, x: f64, y: f64) -> Self {
        Self {
            kind: kind.into(),
            agent_id: None,
            x,
            y,
            bounds: None,
            label: String::new(),
            keys: None,
            text_length: None,
        }
    }

    pub fn validate(&self) -> Result<(), &'static str> {
        if self
            .agent_id
            .as_deref()
            .is_some_and(|id| !["agent-1", "agent-2", "agent-3"].contains(&id))
        {
            return Err("Unknown desktop agent");
        }
        if !self.x.is_finite()
            || !self.y.is_finite()
            || self.x.abs() > 100_000.0
            || self.y.abs() > 100_000.0
        {
            return Err("Invalid cursor position");
        }
        if self.bounds.as_ref().is_some_and(|b| !b.valid()) {
            return Err("Invalid target bounds");
        }
        if ![
            "preparing",
            "move",
            "click",
            "double-click",
            "right-click",
            "drag",
            "scroll",
            "type",
            "key",
            "select",
            "check",
            "uncheck",
            "expand",
            "collapse",
            "clear",
            "set-value",
            "scroll-to",
            "launch",
        ]
        .contains(&self.kind.as_str())
        {
            return Err("Unknown cursor action");
        }
        if self.label.chars().count() > 80 || self.keys.as_ref().is_some_and(|keys| keys.len() > 80)
        {
            return Err("Cursor label is too long");
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_invalid_geometry_and_unbounded_labels() {
        let mut action = ActionPreview::new("click", 12.0, -20.0);
        assert!(action.validate().is_ok());
        action.agent_id = Some("../other".into());
        assert!(action.validate().is_err());
        action.agent_id = Some("agent-3".into());
        assert!(action.validate().is_ok());
        action.x = f64::NAN;
        assert!(action.validate().is_err());
        action.x = 12.0;
        action.bounds = Some(TargetBounds {
            x: 0.0,
            y: 0.0,
            width: -1.0,
            height: 10.0,
        });
        assert!(action.validate().is_err());
        action.bounds = None;
        action.label = "x".repeat(81);
        assert!(action.validate().is_err());
    }
}
