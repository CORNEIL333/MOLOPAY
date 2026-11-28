use std::collections::{BTreeMap, HashMap, HashSet};

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde_json::{Map, Number, Value};
use sha2::{Digest, Sha256};

use crate::error::{VerifyError, VerifyResult};
use crate::hex;
use crate::jcs;
use crate::merkle::{self, Hash};
use crate::model::{Entry, Export, Posting, TreeHead};

const MAX_BIGINT: i128 = i64::MAX as i128;
const MAX_ORDINAL: u32 = i16::MAX as u32;

// Liste blanche : un type inconnu est refusé même si son hash est cohérent,
// car le vérificateur ne peut pas savoir quelles règles métier il porte.
// HANDOVER : remise au marchand (lot 12, migration 0040, D45).
// BENEFICIARY_PAYMENT : règlement au bénéficiaire C (migration 0043, D48).
// REFUND_SENT : remboursement au client (migration 0045, D49).
const ALLOWED_ENTRY_TYPES: [&str; 11] = [
    "ADJUSTMENT",
    "BENEFICIARY_PAYMENT",
    "FEE_CHARGED",
    "GENESIS",
    "HANDOVER",
    "PAYMENT_CONFIRMED",
    "PAYMENT_RECEIVED",
    "PAYMENT_REVERSED",
    "REFUND_SENT",
    "REVERSAL",
    "SETTLEMENT_SENT",
];

#[derive(Debug)]
pub struct Report {
    pub entries: usize,
    pub heads: usize,
    pub witnesses: usize,
    pub last_tree_size: u64,
    pub log_id: String,
}

pub fn verify(export: &Export, public_key: &VerifyingKey) -> VerifyResult<Report> {
    if export.version != 1 {
        return Err(VerifyError::new(
            "EXPORT_INVALID",
            format!("version d’export {} non supportée", export.version),
        ));
    }
    if export.log_id.trim().is_empty() {
        return Err(VerifyError::new("EXPORT_INVALID", "log_id vide"));
    }
    if !valid_iso_utc_ms(&export.generated_at) {
        return Err(VerifyError::new(
            "EXPORT_INVALID",
            "generated_at doit être ISO 8601 UTC avec millisecondes",
        ));
    }
    if export.entries.is_empty() {
        return Err(VerifyError::new("LEDGER_EMPTY", "aucune écriture à vérifier"));
    }

    let mut hashes: Vec<Hash> = Vec::with_capacity(export.entries.len());
    let mut id_index: HashMap<String, usize> = HashMap::new();
    let mut idempotency: HashSet<(String, String)> = HashSet::new();
    let mut previous: Hash = [0u8; 32];

    for (index, entry) in export.entries.iter().enumerate() {
        let expected_seq = index as u64 + 1;
        if entry.seq != expected_seq {
            return Err(VerifyError::new(
                "SEQUENCE_GAP",
                format!(
                    "séquence attendue {expected_seq}, reçue {}",
                    entry.seq
                ),
            ));
        }
        validate_entry(entry)?;
        if index == 0 {
            if entry.kind != "GENESIS" {
                return Err(VerifyError::new(
                    "GENESIS_INVALID",
                    "la première écriture doit être GENESIS",
                ));
            }
            if entry.reverses_entry_id.is_some() {
                return Err(VerifyError::new(
                    "GENESIS_INVALID",
                    "la genèse ne peut pas contre-passer une écriture",
                ));
            }
        } else {
            if entry.kind == "GENESIS" {
                return Err(VerifyError::new(
                    "GENESIS_INVALID",
                    format!("genèse supplémentaire à la séquence {}", entry.seq),
                ));
            }
            if entry.postings.is_empty() {
                return Err(VerifyError::new(
                    "ENTRY_INVALID",
                    format!("écriture {} sans ligne", entry.seq),
                ));
            }
        }

        let prev = decode_hash(&entry.prev_hash, "prev_hash")?;
        if prev != previous {
            return Err(VerifyError::new(
                "PREV_HASH_MISMATCH",
                format!("séquence {} : prev_hash ne suit pas la chaîne", entry.seq),
            ));
        }
        let canonical = canonical_entry(entry)?;
        let computed = hash_entry(&prev, &canonical);
        let claimed = decode_hash(&entry.entry_hash, "entry_hash")?;
        if computed != claimed {
            return Err(VerifyError::new(
                "ENTRY_HASH_MISMATCH",
                format!("séquence {} : entry_hash recalculé différent", entry.seq),
            ));
        }

        if id_index.insert(entry.id.clone(), index).is_some() {
            return Err(VerifyError::new(
                "DUPLICATE_ENTRY_ID",
                format!("identifiant dupliqué: {}", entry.id),
            ));
        }
        if !idempotency.insert((entry.idem_scope.clone(), entry.idem_key.clone())) {
            return Err(VerifyError::new(
                "IDEMPOTENCY_DUPLICATE",
                format!(
                    "clé d’idempotence rejouée: ({}, {})",
                    entry.idem_scope, entry.idem_key
                ),
            ));
        }

        hashes.push(claimed);
        previous = claimed;
    }

    verify_reversals(export, &id_index)?;

    if export.tree_heads.is_empty() {
        return Err(VerifyError::new(
            "HEAD_COVERAGE_MISSING",
            "aucune tête d’arbre signée dans l’export",
        ));
    }
    let mut verified_heads: Vec<(u64, Hash)> = Vec::new();
    let mut previous_size: u64 = 0;
    let mut previous_timestamp: Option<&str> = None;
    for head in &export.tree_heads {
        if head.log_id != export.log_id {
            return Err(VerifyError::new(
                "TREE_HEAD_INVALID",
                format!("tête de taille {} : log_id différent", head.tree_size),
            ));
        }
        if !valid_iso_utc_ms(&head.timestamp) {
            return Err(VerifyError::new(
                "TREE_HEAD_INVALID",
                format!("tête de taille {} : horodatage invalide", head.tree_size),
            ));
        }
        if let Some(previous_timestamp) = previous_timestamp {
            if head.timestamp.as_str() < previous_timestamp {
                return Err(VerifyError::new(
                    "TREE_HEAD_INVALID",
                    "horodatages de têtes décroissants",
                ));
            }
        }
        previous_timestamp = Some(head.timestamp.as_str());
        if head.tree_size == 0 || head.tree_size <= previous_size {
            return Err(VerifyError::new(
                "TREE_HEAD_INVALID",
                format!("taille de tête non croissante: {}", head.tree_size),
            ));
        }
        let size = usize::try_from(head.tree_size).map_err(|_| {
            VerifyError::new("TREE_HEAD_INVALID", "taille de tête hors bornes")
        })?;
        if size > hashes.len() {
            return Err(VerifyError::new(
                "TREE_HEAD_INVALID",
                format!(
                    "tête de taille {} dépasse le journal ({} écritures)",
                    head.tree_size,
                    hashes.len()
                ),
            ));
        }
        let root = decode_hash(&head.root_hash, "root_hash")?;
        let expected_root = merkle::root(&hashes[..size]);
        if root != expected_root {
            return Err(VerifyError::new(
                "MERKLE_ROOT_MISMATCH",
                format!("tête de taille {} : racine Merkle différente", head.tree_size),
            ));
        }
        let payload = canonical_tree_head(head)?;
        let signature_bytes = BASE64.decode(&head.signature).map_err(|_| {
            VerifyError::new(
                "SIGNATURE_INVALID",
                format!("tête de taille {} : signature base64 invalide", head.tree_size),
            )
        })?;
        let signature = Signature::from_slice(&signature_bytes).map_err(|_| {
            VerifyError::new(
                "SIGNATURE_INVALID",
                format!("tête de taille {} : signature de taille invalide", head.tree_size),
            )
        })?;
        public_key
            .verify(payload.as_bytes(), &signature)
            .map_err(|_| {
                VerifyError::new(
                    "SIGNATURE_INVALID",
                    format!("tête de taille {} : signature Ed25519 invalide", head.tree_size),
                )
            })?;
        previous_size = head.tree_size;
        verified_heads.push((head.tree_size, root));
    }

    let last_head = export.tree_heads.last().ok_or_else(|| {
        VerifyError::new("HEAD_COVERAGE_MISSING", "aucune tête d’arbre")
    })?;
    if last_head.tree_size != export.entries.len() as u64 {
        return Err(VerifyError::new(
            "HEAD_COVERAGE_MISSING",
            format!(
                "la dernière tête couvre {} écritures sur {}",
                last_head.tree_size,
                export.entries.len()
            ),
        ));
    }

    if export.witness_heads.is_empty() {
        return Err(VerifyError::new(
            "WITNESS_MISSING",
            "aucune tête reçue d’un témoin",
        ));
    }
    let mut max_witness_size: u64 = 0;
    for witness in &export.witness_heads {
        let root = decode_hash(&witness.root_hash, "witness root_hash")?;
        if !verified_heads
            .iter()
            .any(|(size, verified_root)| *size == witness.tree_size && *verified_root == root)
        {
            return Err(VerifyError::new(
                "WITNESS_MISMATCH",
                format!(
                    "tête témoin de taille {} absente des têtes signées",
                    witness.tree_size
                ),
            ));
        }
        if witness.tree_size > max_witness_size {
            max_witness_size = witness.tree_size;
        }
    }
    if max_witness_size != export.entries.len() as u64 {
        return Err(VerifyError::new(
            "WITNESS_COVERAGE_MISSING",
            format!(
                "le témoin le plus récent couvre {max_witness_size} écritures sur {}",
                export.entries.len()
            ),
        ));
    }

    Ok(Report {
        entries: export.entries.len(),
        heads: export.tree_heads.len(),
        witnesses: export.witness_heads.len(),
        last_tree_size: last_head.tree_size,
        log_id: export.log_id.clone(),
    })
}

fn validate_entry(entry: &Entry) -> VerifyResult<()> {
    if !valid_uuid_v7(&entry.id) {
        return Err(VerifyError::new(
            "ENTRY_INVALID",
            format!("séquence {} : identifiant non UUID v7", entry.seq),
        ));
    }
    if !valid_iso_utc_ms(&entry.ts) {
        return Err(VerifyError::new(
            "ENTRY_INVALID",
            format!("séquence {} : horodatage invalide", entry.seq),
        ));
    }
    if entry.kind.trim().is_empty()
        || entry.actor.trim().is_empty()
        || entry.idem_scope.trim().is_empty()
        || entry.idem_key.trim().is_empty()
    {
        return Err(VerifyError::new(
            "ENTRY_INVALID",
            format!("séquence {} : champ texte vide", entry.seq),
        ));
    }
    if !is_allowed_entry_type(&entry.kind) {
        return Err(VerifyError::new(
            "ENTRY_INVALID",
            format!(
                "séquence {} : type d’écriture inconnu « {} »",
                entry.seq, entry.kind
            ),
        ));
    }
    if !entry.refs.is_object() {
        return Err(VerifyError::new(
            "ENTRY_INVALID",
            format!("séquence {} : refs n’est pas un objet", entry.seq),
        ));
    }
    if let Some(reverses) = &entry.reverses_entry_id {
        if !valid_uuid_v7(reverses) {
            return Err(VerifyError::new(
                "ENTRY_INVALID",
                format!("séquence {} : reverses_entry_id non UUID v7", entry.seq),
            ));
        }
    }

    let mut seen_approvers: HashSet<&str> = HashSet::new();
    for approver in &entry.approvers {
        if approver.trim().is_empty() {
            return Err(VerifyError::new(
                "ENTRY_INVALID",
                format!("séquence {} : approbateur vide", entry.seq),
            ));
        }
        if !seen_approvers.insert(approver.as_str()) {
            return Err(VerifyError::new(
                "ENTRY_INVALID",
                format!("séquence {} : approbateur dupliqué", entry.seq),
            ));
        }
    }

    if entry.postings.len() == 1 {
        return Err(VerifyError::new(
            "ENTRY_INVALID",
            format!(
                "séquence {} : une écriture exige zéro (genèse) ou au moins deux lignes",
                entry.seq
            ),
        ));
    }
    if entry.postings.is_empty() && entry.kind != "GENESIS" {
        return Err(VerifyError::new(
            "ENTRY_INVALID",
            format!("séquence {} : seule la genèse peut être vide", entry.seq),
        ));
    }

    let mut ordinals: HashSet<u32> = HashSet::new();
    let mut account_directions: HashSet<(String, String)> = HashSet::new();
    let mut debits: i128 = 0;
    let mut credits: i128 = 0;
    let mut has_debit = false;
    let mut has_credit = false;
    for posting in &entry.postings {
        if !valid_uuid_v7(&posting.account_id) {
            return Err(VerifyError::new(
                "POSTING_INVALID",
                format!("séquence {} : compte non UUID v7", entry.seq),
            ));
        }
        if posting.direction != "D" && posting.direction != "C" {
            return Err(VerifyError::new(
                "POSTING_INVALID",
                format!("séquence {} : direction invalide", entry.seq),
            ));
        }
        if posting.ordinal == 0 || posting.ordinal > MAX_ORDINAL {
            return Err(VerifyError::new(
                "POSTING_INVALID",
                format!("séquence {} : ordinal hors bornes", entry.seq),
            ));
        }
        if !ordinals.insert(posting.ordinal) {
            return Err(VerifyError::new(
                "POSTING_INVALID",
                format!("séquence {} : ordinal dupliqué", entry.seq),
            ));
        }
        if !account_directions
            .insert((posting.account_id.clone(), posting.direction.clone()))
        {
            return Err(VerifyError::new(
                "POSTING_INVALID",
                format!("séquence {} : couple compte/direction dupliqué", entry.seq),
            ));
        }
        let amount = parse_amount(&posting.amount_xaf, entry.seq)?;
        if posting.direction == "D" {
            has_debit = true;
            debits = debits.checked_add(amount).ok_or_else(|| {
                VerifyError::new("POSTING_INVALID", "somme des débits hors bornes")
            })?;
        } else {
            has_credit = true;
            credits = credits.checked_add(amount).ok_or_else(|| {
                VerifyError::new("POSTING_INVALID", "somme des crédits hors bornes")
            })?;
        }
    }

    if !entry.postings.is_empty() {
        if !has_debit || !has_credit {
            return Err(VerifyError::new(
                "ENTRY_UNBALANCED",
                format!("séquence {} : débit et crédit exigés", entry.seq),
            ));
        }
        if debits != credits {
            return Err(VerifyError::new(
                "ENTRY_UNBALANCED",
                format!(
                    "séquence {} : débits {} ≠ crédits {}",
                    entry.seq, debits, credits
                ),
            ));
        }
    }
    Ok(())
}

fn verify_reversals(
    export: &Export,
    id_index: &HashMap<String, usize>,
) -> VerifyResult<()> {
    let mut reversed_targets: HashSet<String> = HashSet::new();
    for (index, entry) in export.entries.iter().enumerate() {
        let target_id = match &entry.reverses_entry_id {
            Some(target_id) => target_id,
            None => continue,
        };
        let target_index = id_index.get(target_id).copied().ok_or_else(|| {
            VerifyError::new(
                "REVERSAL_INVALID",
                format!("séquence {} : écriture d’origine absente", entry.seq),
            )
        })?;
        if target_index >= index {
            return Err(VerifyError::new(
                "REVERSAL_INVALID",
                format!("séquence {} : l’origine doit précéder la contre-passation", entry.seq),
            ));
        }
        let target = export.entries.get(target_index).ok_or_else(|| {
            VerifyError::new("REVERSAL_INVALID", "écriture d’origine introuvable")
        })?;
        if target.reverses_entry_id.is_some() {
            return Err(VerifyError::new(
                "REVERSAL_INVALID",
                format!("séquence {} : une contre-passation ne se contre-passe pas", entry.seq),
            ));
        }
        if target.kind == "GENESIS" {
            return Err(VerifyError::new(
                "REVERSAL_INVALID",
                format!("séquence {} : la genèse ne se contre-passe pas", entry.seq),
            ));
        }
        if !reversed_targets.insert(target_id.clone()) {
            return Err(VerifyError::new(
                "REVERSAL_INVALID",
                format!("écriture {} contre-passée plusieurs fois", target.seq),
            ));
        }
        if entry.approvers.is_empty() || entry.approvers.iter().any(|item| item == &entry.actor) {
            return Err(VerifyError::new(
                "REVERSAL_INVALID",
                format!("séquence {} : approbateur distinct exigé", entry.seq),
            ));
        }

        let mut expected: BTreeMap<(String, String, i128), usize> = BTreeMap::new();
        for posting in &target.postings {
            let amount = parse_amount(&posting.amount_xaf, target.seq)?;
            let key = (
                posting.account_id.clone(),
                flip_direction(&posting.direction).to_string(),
                amount,
            );
            *expected.entry(key).or_insert(0) += 1;
        }
        for posting in &entry.postings {
            let amount = parse_amount(&posting.amount_xaf, entry.seq)?;
            let key = (
                posting.account_id.clone(),
                posting.direction.clone(),
                amount,
            );
            let count = expected.get_mut(&key).ok_or_else(|| {
                VerifyError::new(
                    "REVERSAL_INVALID",
                    format!("séquence {} : ligne absente du miroir", entry.seq),
                )
            })?;
            if *count == 0 {
                return Err(VerifyError::new(
                    "REVERSAL_INVALID",
                    format!("séquence {} : ligne en trop dans le miroir", entry.seq),
                ));
            }
            *count -= 1;
        }
        if expected.values().any(|count| *count != 0) {
            return Err(VerifyError::new(
                "REVERSAL_INVALID",
                format!("séquence {} : miroir incomplet", entry.seq),
            ));
        }
    }
    Ok(())
}

fn canonical_entry(entry: &Entry) -> VerifyResult<String> {
    let mut ordered: Vec<&Posting> = entry.postings.iter().collect();
    ordered.sort_by_key(|posting| posting.ordinal);
    let postings: Vec<Value> = ordered
        .into_iter()
        .map(|posting| {
            let mut item = Map::new();
            item.insert(
                "account_id".to_string(),
                Value::String(posting.account_id.clone()),
            );
            item.insert(
                "amount_xaf".to_string(),
                Value::String(posting.amount_xaf.clone()),
            );
            item.insert(
                "direction".to_string(),
                Value::String(posting.direction.clone()),
            );
            item.insert(
                "ordinal".to_string(),
                Value::Number(Number::from(posting.ordinal)),
            );
            Value::Object(item)
        })
        .collect();

    let mut approvers: Vec<&String> = entry.approvers.iter().collect();
    approvers.sort_by(|left, right| left.encode_utf16().cmp(right.encode_utf16()));

    let mut object = Map::new();
    object.insert("actor".to_string(), Value::String(entry.actor.clone()));
    object.insert(
        "approvers".to_string(),
        Value::Array(
            approvers
                .into_iter()
                .map(|approver| Value::String(approver.clone()))
                .collect(),
        ),
    );
    object.insert("id".to_string(), Value::String(entry.id.clone()));
    object.insert(
        "idem_key".to_string(),
        Value::String(entry.idem_key.clone()),
    );
    object.insert(
        "idem_scope".to_string(),
        Value::String(entry.idem_scope.clone()),
    );
    object.insert("postings".to_string(), Value::Array(postings));
    object.insert("refs".to_string(), entry.refs.clone());
    object.insert(
        "reverses_entry_id".to_string(),
        match &entry.reverses_entry_id {
            Some(id) => Value::String(id.clone()),
            None => Value::Null,
        },
    );
    object.insert("seq".to_string(), Value::Number(Number::from(entry.seq)));
    object.insert("ts".to_string(), Value::String(entry.ts.clone()));
    object.insert("type".to_string(), Value::String(entry.kind.clone()));

    jcs::canonicalize(&Value::Object(object))
        .map_err(|message| VerifyError::new("ENTRY_INVALID", message))
}

fn canonical_tree_head(head: &TreeHead) -> VerifyResult<String> {
    let mut object = Map::new();
    object.insert(
        "algorithm".to_string(),
        Value::String("Ed25519".to_string()),
    );
    object.insert("log_id".to_string(), Value::String(head.log_id.clone()));
    object.insert(
        "root_hash".to_string(),
        Value::String(head.root_hash.to_ascii_lowercase()),
    );
    object.insert(
        "timestamp".to_string(),
        Value::String(head.timestamp.clone()),
    );
    object.insert(
        "tree_size".to_string(),
        Value::Number(Number::from(head.tree_size)),
    );
    jcs::canonicalize(&Value::Object(object))
        .map_err(|message| VerifyError::new("TREE_HEAD_INVALID", message))
}

fn hash_entry(previous: &Hash, canonical: &str) -> Hash {
    let mut hasher = Sha256::new();
    hasher.update(previous);
    hasher.update(canonical.as_bytes());
    hasher.finalize().into()
}

fn decode_hash(value: &str, field: &str) -> VerifyResult<Hash> {
    hex::decode_32(value, field)
        .map_err(|message| VerifyError::new("HASH_FORMAT_INVALID", message))
}

fn parse_amount(value: &str, seq: u64) -> VerifyResult<i128> {
    if value.is_empty() {
        return Err(VerifyError::new(
            "POSTING_INVALID",
            format!("séquence {seq} : montant vide"),
        ));
    }
    if value.len() > 1 && value.starts_with('0') {
        return Err(VerifyError::new(
            "POSTING_INVALID",
            format!("séquence {seq} : montant non canonique"),
        ));
    }
    if !value.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err(VerifyError::new(
            "POSTING_INVALID",
            format!("séquence {seq} : montant non entier"),
        ));
    }
    let amount: i128 = value.parse().map_err(|_| {
        VerifyError::new(
            "POSTING_INVALID",
            format!("séquence {seq} : montant hors bornes"),
        )
    })?;
    if amount <= 0 || amount > MAX_BIGINT {
        return Err(VerifyError::new(
            "POSTING_INVALID",
            format!("séquence {seq} : montant hors bornes"),
        ));
    }
    Ok(amount)
}

fn flip_direction(direction: &str) -> &str {
    if direction == "D" {
        "C"
    } else {
        "D"
    }
}

fn valid_uuid_v7(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.len() != 36 {
        return false;
    }
    for (index, byte) in bytes.iter().enumerate() {
        match index {
            8 | 13 | 18 | 23 => {
                if *byte != b'-' {
                    return false;
                }
            }
            14 => {
                if *byte != b'7' {
                    return false;
                }
            }
            19 => {
                if !matches!(*byte, b'8' | b'9' | b'a' | b'b') {
                    return false;
                }
            }
            _ => {
                if !byte.is_ascii_digit() && !(b'a'..=b'f').contains(byte) {
                    return false;
                }
            }
        }
    }
    true
}

fn valid_iso_utc_ms(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.len() != 24 {
        return false;
    }
    for (index, byte) in bytes.iter().enumerate() {
        match index {
            4 | 7 => {
                if *byte != b'-' {
                    return false;
                }
            }
            10 => {
                if *byte != b'T' {
                    return false;
                }
            }
            13 | 16 => {
                if *byte != b':' {
                    return false;
                }
            }
            19 => {
                if *byte != b'.' {
                    return false;
                }
            }
            23 => {
                if *byte != b'Z' {
                    return false;
                }
            }
            _ => {
                if !byte.is_ascii_digit() {
                    return false;
                }
            }
        }
    }
    let number = |start: usize, length: usize| -> u32 {
        bytes[start..start + length]
            .iter()
            .fold(0u32, |acc, byte| acc * 10 + u32::from(byte - b'0'))
    };
    let year = number(0, 4);
    let month = number(5, 2);
    let day = number(8, 2);
    let hour = number(11, 2);
    let minute = number(14, 2);
    let second = number(17, 2);
    if !(1..=12).contains(&month) || hour > 23 || minute > 59 || second > 59 {
        return false;
    }
    if year == 0 {
        return false;
    }
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let days = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if leap => 29,
        2 => 28,
        _ => return false,
    };
    day >= 1 && day <= days
}

fn is_allowed_entry_type(kind: &str) -> bool {
    ALLOWED_ENTRY_TYPES.contains(&kind)
}

#[cfg(test)]
mod tests {
    use ed25519_dalek::VerifyingKey;
    use serde_json::Value;

    use crate::hex;
    use crate::model::Export;

    use super::{is_allowed_entry_type, verify};

    const FIXTURE: &str = include_str!("../../../tests/fixtures/ledger-export.json");
    const PUBLIC_KEY: &str = include_str!("../../../tests/fixtures/ledger-public-key.txt");

    fn fixture_export() -> Export {
        serde_json::from_str(FIXTURE).expect("export de test valide")
    }

    fn fixture_key() -> VerifyingKey {
        let raw = hex::decode_32(PUBLIC_KEY.trim(), "public key").expect("clé publique");
        VerifyingKey::from_bytes(&raw).expect("clé Ed25519")
    }

    #[test]
    fn verifie_la_fixture_de_reference() {
        let report = verify(&fixture_export(), &fixture_key()).expect("fixture valide");
        assert_eq!(report.entries, 6);
        assert_eq!(report.heads, 3);
        assert_eq!(report.witnesses, 2);
        assert_eq!(report.last_tree_size, 6);
    }

    #[test]
    fn detecte_un_montant_altere() {
        let mut value: Value = serde_json::from_str(FIXTURE).expect("json");
        value["entries"][1]["postings"][0]["amount_xaf"] = Value::String("15001".to_string());
        let export: Export = serde_json::from_value(value).expect("export");
        let error = verify(&export, &fixture_key()).expect_err("altération détectée");
        assert_eq!(error.code, "ENTRY_UNBALANCED");
    }

    #[test]
    fn detecte_une_signature_alteree() {
        let mut value: Value = serde_json::from_str(FIXTURE).expect("json");
        value["tree_heads"][0]["signature"] = Value::String("AAAA".to_string());
        let export: Export = serde_json::from_value(value).expect("export");
        let error = verify(&export, &fixture_key()).expect_err("altération détectée");
        assert_eq!(error.code, "SIGNATURE_INVALID");
    }

    #[test]
    fn detecte_une_tete_temoin_alteree() {
        let mut value: Value = serde_json::from_str(FIXTURE).expect("json");
        value["witness_heads"][0]["root_hash"] =
            Value::String("00".repeat(32));
        let export: Export = serde_json::from_value(value).expect("export");
        let error = verify(&export, &fixture_key()).expect_err("altération détectée");
        assert_eq!(error.code, "WITNESS_MISMATCH");
    }

    #[test]
    fn liste_blanche_des_types_d_ecriture() {
        for kind in ["GENESIS", "PAYMENT_CONFIRMED", "HANDOVER", "BENEFICIARY_PAYMENT", "REFUND_SENT", "SETTLEMENT_SENT"] {
            assert!(is_allowed_entry_type(kind), "{kind} doit être accepté");
        }
        for kind in ["", "handover", "PAYMENT", "TEST_TRANSFER"] {
            assert!(!is_allowed_entry_type(kind), "{kind} doit être refusé");
        }
    }
}
