use serde::Deserialize;

#[derive(Debug, Deserialize, Clone)]
#[serde(deny_unknown_fields)]
pub struct Export {
    pub version: u32,
    pub log_id: String,
    pub generated_at: String,
    pub entries: Vec<Entry>,
    #[serde(default)]
    pub tree_heads: Vec<TreeHead>,
    #[serde(default)]
    pub witness_heads: Vec<WitnessHead>,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(deny_unknown_fields)]
pub struct Entry {
    pub seq: u64,
    pub id: String,
    pub ts: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub refs: serde_json::Value,
    pub postings: Vec<Posting>,
    pub actor: String,
    pub approvers: Vec<String>,
    pub idem_scope: String,
    pub idem_key: String,
    pub reverses_entry_id: Option<String>,
    pub prev_hash: String,
    pub entry_hash: String,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(deny_unknown_fields)]
pub struct Posting {
    pub account_id: String,
    pub amount_xaf: String,
    pub direction: String,
    pub ordinal: u32,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(deny_unknown_fields)]
pub struct TreeHead {
    pub tree_size: u64,
    pub root_hash: String,
    pub timestamp: String,
    pub log_id: String,
    pub signature: String,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(deny_unknown_fields)]
pub struct WitnessHead {
    pub tree_size: u64,
    pub root_hash: String,
}
