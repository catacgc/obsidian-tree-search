use wasm_bindgen::prelude::*;

mod frontmatter;
mod list_scanner;

/// Initialize the panic hook so that Rust panics produce useful error
/// messages in the JavaScript console instead of opaque "unreachable" errors.
#[wasm_bindgen(start)]
pub fn init() {
    console_error_panic_hook::set_once();
}

#[wasm_bindgen]
pub fn ping() -> String {
    "pong".to_string()
}

#[wasm_bindgen]
pub fn parse_frontmatter(content: &str) -> String {
    let result = frontmatter::parse_frontmatter(content);
    serde_json::to_string(&result).unwrap_or_else(|_| r#"{"frontmatter":{},"bodyStart":0}"#.to_string())
}

#[wasm_bindgen]
pub fn scan_markdown(content: &str, file_path: &str, frontmatter_body_start: usize, archive_tag: &str) -> String {
    let result = list_scanner::scan_markdown(content, file_path, frontmatter_body_start, archive_tag);
    serde_json::to_string(&result).unwrap_or_else(|_| r#"{"lists":[],"headers":[]}"#.to_string())
}
