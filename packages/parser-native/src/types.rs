use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::inline_tokens::ParsedToken;
use crate::list_scanner::{HeadingCacheItem, LinkRef, ListPosition, Section};

// ── Input type ──────────────────────────────────────────────────────────────

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BatchFileInput {
    pub path: String,
    pub content: String,
    pub mtime: f64,
    pub archive_tag: String,
}

// ── Output types ────────────────────────────────────────────────────────────

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BatchParsedPage {
    pub file: BatchFileInfo,
    pub headers: Vec<HeadingCacheItem>,
    pub precomputed_parent_tokens: HashMap<String, Vec<ParsedToken>>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BatchFileInfo {
    pub aliases: AliasesWrapper,
    pub name: String,
    pub mtime: MtimeWrapper,
    pub path: String,
    pub frontmatter: serde_json::Value,
    pub lists: ListsWrapper,
    pub tags: Vec<String>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AliasesWrapper {
    pub values: Vec<String>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MtimeWrapper {
    pub ts: f64,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ListsWrapper {
    pub values: Vec<BatchDvListItem>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BatchDvListItem {
    pub link: LinkRef,
    pub text: String,
    pub raw_text: String,
    pub line: usize,
    pub position: ListPosition,
    pub parent: Option<usize>,
    pub children: Vec<BatchDvListItem>,
    pub tags: Vec<String>,
    pub section: Section,
    pub task: bool,
    pub completed: bool,
    pub precomputed_tokens: Vec<ParsedToken>,
}
