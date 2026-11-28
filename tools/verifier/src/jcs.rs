use std::fmt::Write;

use serde_json::Value;

const MAX_DEPTH: usize = 32;
const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

pub fn canonicalize(value: &Value) -> Result<String, String> {
    serialize(value, 0)
}

fn serialize(value: &Value, depth: usize) -> Result<String, String> {
    if depth > MAX_DEPTH {
        return Err("profondeur JSON excessive".to_string());
    }
    match value {
        Value::Null => Ok("null".to_string()),
        Value::Bool(true) => Ok("true".to_string()),
        Value::Bool(false) => Ok("false".to_string()),
        Value::Number(number) => encode_number(number),
        Value::String(text) => Ok(encode_string(text)),
        Value::Array(items) => {
            let mut parts = Vec::with_capacity(items.len());
            for item in items {
                parts.push(serialize(item, depth + 1)?);
            }
            Ok(format!("[{}]", parts.join(",")))
        }
        Value::Object(map) => {
            let mut entries: Vec<(&String, &Value)> = map.iter().collect();
            entries.sort_by(|left, right| left.0.encode_utf16().cmp(right.0.encode_utf16()));
            let mut parts = Vec::with_capacity(entries.len());
            for (key, item) in entries {
                parts.push(format!(
                    "{}:{}",
                    encode_string(key),
                    serialize(item, depth + 1)?
                ));
            }
            Ok(format!("{{{}}}", parts.join(",")))
        }
    }
}

fn encode_number(number: &serde_json::Number) -> Result<String, String> {
    if let Some(value) = number.as_i64() {
        if value.unsigned_abs() > MAX_SAFE_INTEGER {
            return Err("entier hors plage sûre".to_string());
        }
        return Ok(value.to_string());
    }
    if let Some(value) = number.as_u64() {
        if value > MAX_SAFE_INTEGER {
            return Err("entier hors plage sûre".to_string());
        }
        return Ok(value.to_string());
    }
    Err("flottants interdits dans la sérialisation canonique".to_string())
}

fn encode_string(value: &str) -> String {
    let mut output = String::with_capacity(value.len() + 2);
    output.push('"');
    for character in value.chars() {
        match character {
            '"' => output.push_str("\\\""),
            '\\' => output.push_str("\\\\"),
            '\u{08}' => output.push_str("\\b"),
            '\u{09}' => output.push_str("\\t"),
            '\u{0a}' => output.push_str("\\n"),
            '\u{0c}' => output.push_str("\\f"),
            '\u{0d}' => output.push_str("\\r"),
            character if (character as u32) < 0x20 => {
                let _ = write!(output, "\\u{:04x}", character as u32);
            }
            character => output.push(character),
        }
    }
    output.push('"');
    output
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::canonicalize;

    #[test]
    fn trie_les_cles_et_echappe_les_caracteres() {
        let value = json!({
            "b": "ligne\n\"guillemets\"",
            "a": true,
            "c": [null, 1],
        });
        assert_eq!(
            canonicalize(&value).expect("canonique"),
            "{\"a\":true,\"b\":\"ligne\\n\\\"guillemets\\\"\",\"c\":[null,1]}"
        );
    }

    #[test]
    fn trie_les_cles_selon_utf16() {
        let astral = "\u{10000}";
        let bmp = "\u{e000}";
        let mut map = serde_json::Map::new();
        map.insert(astral.to_string(), serde_json::Value::from(2));
        map.insert(bmp.to_string(), serde_json::Value::from(1));
        let canonical = canonicalize(&serde_json::Value::Object(map)).expect("canonique");
        let astral_position = canonical.find(astral).expect("clé astrale");
        let bmp_position = canonical.find(bmp).expect("clé BMP");
        assert!(astral_position < bmp_position);
    }

    #[test]
    fn refuse_les_flottants_et_entiers_hors_plage() {
        assert!(canonicalize(&json!(1.5)).is_err());
        assert!(canonicalize(&json!(9_007_199_254_740_992u64)).is_err());
        assert!(canonicalize(&json!(-9_007_199_254_740_992i64)).is_err());
    }
}
