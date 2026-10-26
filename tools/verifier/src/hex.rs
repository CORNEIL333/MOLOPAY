pub fn decode(value: &str) -> Result<Vec<u8>, String> {
    if value.len() % 2 != 0 {
        return Err("longueur hexadécimale impaire".to_string());
    }
    let bytes = value.as_bytes();
    let mut output = Vec::with_capacity(bytes.len() / 2);
    for pair in bytes.chunks_exact(2) {
        let high = digit(pair[0])?;
        let low = digit(pair[1])?;
        output.push((high << 4) | low);
    }
    Ok(output)
}

pub fn decode_32(value: &str, field: &str) -> Result<[u8; 32], String> {
    let bytes = decode(value)?;
    if bytes.len() != 32 {
        return Err(format!(
            "{field} doit faire 32 octets (reçu {})",
            bytes.len()
        ));
    }
    let mut output = [0u8; 32];
    output.copy_from_slice(&bytes);
    Ok(output)
}

fn digit(value: u8) -> Result<u8, String> {
    match value {
        b'0'..=b'9' => Ok(value - b'0'),
        b'a'..=b'f' => Ok(value - b'a' + 10),
        b'A'..=b'F' => Ok(value - b'A' + 10),
        _ => Err(format!("caractère hexadécimal invalide: {}", value as char)),
    }
}
