use serde_json::Value;
use std::io::{self, Read, Write};
use std::process::Command;

fn read_message() -> io::Result<Option<Value>> {
    let mut length_bytes = [0u8; 4];
    let bytes_read = io::stdin().read(&mut length_bytes)?;
    if bytes_read == 0 {
        return Ok(None); // EOF
    }
    
    let length = u32::from_ne_bytes(length_bytes) as usize;
    let mut buffer = vec![0; length];
    io::stdin().read_exact(&mut buffer)?;
    
    let message: Value = serde_json::from_slice(&buffer)?;
    Ok(Some(message))
}

fn write_message(message: &Value) -> io::Result<()> {
    let json = serde_json::to_string(message)?;
    let length = json.len() as u32;
    
    // IMPORTANT: Write length as native byte order
    io::stdout().write_all(&length.to_ne_bytes())?;
    io::stdout().write_all(json.as_bytes())?;
    io::stdout().flush()?;
    Ok(())
}

fn main() -> io::Result<()> {
    // Note: NEVER use println! here, as stdout is strictly for Chrome Native Messaging Protocol.
    // Use eprintln! for debug logs.
    
    loop {
        match read_message() {
            Ok(Some(msg)) => {
                // Here you would implement your Shell MCP / CLI execution logic.
                // For now, we just echo back the received message as a test.
                // You can inspect `msg` and use `std::process::Command` to run local scripts.
                
                let mut response = serde_json::json!({
                    "status": "success",
                    "received": msg
                });
                
                if let Err(e) = write_message(&response) {
                    eprintln!("Failed to write response: {}", e);
                    break;
                }
            }
            Ok(None) => {
                // Browser closed the connection
                break;
            }
            Err(e) => {
                eprintln!("Error reading message: {}", e);
                break;
            }
        }
    }
    Ok(())
}
