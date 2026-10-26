mod error;
mod hex;
mod jcs;
mod merkle;
mod model;
mod verify;

use std::env;
use std::fs;
use std::process;

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use ed25519_dalek::VerifyingKey;

use error::VerifyError;
use model::Export;
use verify::Report;

const USAGE: &str = "usage: verifier -export <fichier.json> -public-key <fichier>
Vérifie un export du grand livre : équilibre de chaque écriture, chaîne
SHA-256, racines de Merkle RFC 9162, signatures Ed25519 des têtes et
concordance avec les têtes témoins.
Sorties : 0 = vérifié, 1 = altération détectée, 2 = entrée invalide.";

enum RunError {
    Help,
    Usage(String),
    Export(String),
    Verify(VerifyError),
}

fn main() {
    match run() {
        Ok(report) => {
            println!(
                "LEDGER VERIFIED entries={} heads={} witnesses={} last_tree_size={} log_id={}",
                report.entries,
                report.heads,
                report.witnesses,
                report.last_tree_size,
                report.log_id
            );
        }
        Err(RunError::Help) => {
            println!("{USAGE}");
        }
        Err(RunError::Usage(message)) => {
            eprintln!("VERIFIER_USAGE {message}");
            process::exit(2);
        }
        Err(RunError::Export(message)) => {
            eprintln!("EXPORT_INVALID {message}");
            process::exit(2);
        }
        Err(RunError::Verify(error)) => {
            eprintln!("VERIFICATION_FAILED {} {}", error.code, error.detail);
            process::exit(1);
        }
    }
}

fn run() -> Result<Report, RunError> {
    let mut arguments = env::args().skip(1);
    let mut export_path: Option<String> = None;
    let mut public_key_path: Option<String> = None;
    while let Some(argument) = arguments.next() {
        match argument.as_str() {
            "-export" | "--export" => {
                if export_path.is_some() {
                    return Err(RunError::Usage("option -export répétée".to_string()));
                }
                export_path = Some(
                    arguments
                        .next()
                        .ok_or_else(|| RunError::Usage("chemin d’export manquant".to_string()))?,
                );
            }
            "-public-key" | "--public-key" => {
                if public_key_path.is_some() {
                    return Err(RunError::Usage(
                        "option -public-key répétée".to_string(),
                    ));
                }
                public_key_path = Some(
                    arguments
                        .next()
                        .ok_or_else(|| RunError::Usage("chemin de clé publique manquant".to_string()))?,
                );
            }
            "-h" | "--help" => return Err(RunError::Help),
            other => {
                return Err(RunError::Usage(format!(
                    "argument inconnu: {other}\n{USAGE}"
                )));
            }
        }
    }
    let export_path = export_path.ok_or_else(|| {
        RunError::Usage(format!("-export est obligatoire\n{USAGE}"))
    })?;
    let public_key_path = public_key_path.ok_or_else(|| {
        RunError::Usage(format!("-public-key est obligatoire\n{USAGE}"))
    })?;

    let export_bytes = fs::read(&export_path).map_err(|error| {
        RunError::Export(format!("lecture de {export_path} impossible: {error}"))
    })?;
    let export: Export = serde_json::from_slice(&export_bytes).map_err(|error| {
        RunError::Export(format!("JSON invalide dans {export_path}: {error}"))
    })?;
    if export.version != 1 {
        return Err(RunError::Export(format!(
            "version d’export {} non supportée",
            export.version
        )));
    }

    let public_key_text = fs::read_to_string(&public_key_path).map_err(|error| {
        RunError::Export(format!(
            "lecture de la clé publique {public_key_path} impossible: {error}"
        ))
    })?;
    let public_key = parse_public_key(&public_key_text).map_err(RunError::Export)?;

    verify::verify(&export, &public_key).map_err(RunError::Verify)
}

fn parse_public_key(text: &str) -> Result<VerifyingKey, String> {
    let trimmed = text.trim();
    let bytes = if trimmed.len() == 64
        && trimmed.bytes().all(|byte| byte.is_ascii_hexdigit())
    {
        hex::decode(trimmed)?
    } else {
        BASE64
            .decode(trimmed)
            .map_err(|_| "clé publique ni hexadécimale 64 ni base64".to_string())?
    };
    if bytes.len() != 32 {
        return Err(format!(
            "clé publique de {} octets au lieu de 32",
            bytes.len()
        ));
    }
    let mut raw = [0u8; 32];
    raw.copy_from_slice(&bytes);
    VerifyingKey::from_bytes(&raw)
        .map_err(|error| format!("clé Ed25519 invalide: {error}"))
}
