use wasm_bindgen::prelude::*;

mod frontmatter;

#[wasm_bindgen]
pub fn ping() -> String {
    "pong".to_string()
}

#[wasm_bindgen]
pub fn parse_frontmatter(content: &str) -> String {
    let result = frontmatter::parse_frontmatter(content);
    serde_json::to_string(&result).unwrap_or_else(|_| r#"{"frontmatter":{},"bodyStart":0}"#.to_string())
}
