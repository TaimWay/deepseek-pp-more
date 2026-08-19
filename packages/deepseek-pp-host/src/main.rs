use serde_json::{json, Value};
use std::io::{self, Read, Write};
use std::process::{Command, Output};

fn read_message() -> io::Result<Option<Value>> {
    let mut length_bytes = [0u8; 4];
    let bytes_read = io::stdin().read(&mut length_bytes)?;
    if bytes_read == 0 {
        return Ok(None);
    }
    
    // Chrome uses native byte order, typically little endian on x86
    let length = u32::from_ne_bytes(length_bytes) as usize;
    let mut buffer = vec![0; length];
    io::stdin().read_exact(&mut buffer)?;
    
    let message: Value = serde_json::from_slice(&buffer)?;
    Ok(Some(message))
}

fn write_message(message: &Value) -> io::Result<()> {
    let json = serde_json::to_string(message)?;
    let length = json.len() as u32;
    
    io::stdout().write_all(&length.to_ne_bytes())?;
    io::stdout().write_all(json.as_bytes())?;
    io::stdout().flush()?;
    Ok(())
}

fn execute_command(command: &str) -> Output {
    #[cfg(target_os = "windows")]
    {
        Command::new("cmd")
            .args(&["/C", command])
            .output()
            .unwrap_or_else(|e| Output {
                status: Default::default(), // Not actually right but close enough for dummy fallback
                stdout: Vec::new(),
                stderr: e.to_string().into_bytes(),
            })
    }
    #[cfg(not(target_os = "windows"))]
    {
        Command::new("bash")
            .args(&["-c", command])
            .output()
            .unwrap_or_else(|e| Output {
                status: Default::default(),
                stdout: Vec::new(),
                stderr: e.to_string().into_bytes(),
            })
    }
}

fn main() -> io::Result<()> {
    loop {
        match read_message() {
            Ok(Some(msg)) => {
                let mut response = json!({});
                
                // DeepSeek++ Extension protocol expects JSON-RPC 2.0 format
                if let Some(id) = msg.get("message").and_then(|m| m.get("id")) {
                    response["id"] = id.clone();
                }
                response["jsonrpc"] = json!("2.0");

                let method = msg.get("message").and_then(|m| m.get("method")).and_then(|m| m.as_str()).unwrap_or("");
                
                if method == "initialize" {
                    response["result"] = json!({
                        "protocolVersion": "2024-11-05",
                        "capabilities": { "tools": {} },
                        "serverInfo": {
                            "name": "deepseek-pp-shell",
                            "version": "1.0.0"
                        }
                    });
                } else if method == "tools/call" {
                    let cmd = msg
                        .get("message")
                        .and_then(|m| m.get("params"))
                        .and_then(|p| p.get("arguments"))
                        .and_then(|a| a.get("command"))
                        .and_then(|c| c.as_str())
                        .unwrap_or("");

                    let output = execute_command(cmd);
                    let stdout_str = String::from_utf8_lossy(&output.stdout).to_string();
                    let stderr_str = String::from_utf8_lossy(&output.stderr).to_string();

                    response["result"] = json!({
                        "stdout": stdout_str,
                        "stderr": stderr_str,
                        "content": [
                            {
                                "type": "text",
                                "text": stdout_str
                            }
                        ]
                    });
                } else {
                    response["result"] = json!({
                        "stdout": "Unknown method",
                        "content": []
                    });
                }

                if let Err(e) = write_message(&response) {
                    eprintln!("Failed to write response: {}", e);
                    break;
                }
            }
            Ok(None) => break,
            Err(e) => {
                eprintln!("Error reading message: {}", e);
                break;
            }
        }
    }
    Ok(())
}
