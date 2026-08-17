use super::tools::MCPToolRegistry;
use super::types::*;
use crate::database::Repository;
use serde_json::json;
use std::io::{self, BufRead, BufReader, Write};
use std::sync::Arc;

pub struct MCPServer {
    info: MCPServerInfo,
    capabilities: MCPCapabilities,
    tool_registry: MCPToolRegistry,
    /// Lazily-initialized, long-lived tokio runtime used to drive async tool
    /// execution. Reusing a single runtime (instead of creating a fresh one per
    /// `tools/call`) avoids the per-call allocation and thread-spin cost, and
    /// avoids the "cannot start a runtime from within a runtime" panic.
    runtime: std::sync::OnceLock<tokio::runtime::Runtime>,
}

impl MCPServer {
    pub fn new(repository: Arc<Repository>) -> Self {
        Self {
            info: MCPServerInfo {
                name: "Plethora".to_string(),
                version: env!("CARGO_PKG_VERSION").to_string(),
                protocol_version: "2025-06-18".to_string(),
            },
            capabilities: MCPCapabilities {
                tools: Some(ToolsCapability {
                    list_changed: Some(false),
                }),
                resources: None,
                prompts: None,
            },
            tool_registry: MCPToolRegistry::new(repository),
            runtime: std::sync::OnceLock::new(),
        }
    }

    /// Returns a handle to a single long-lived tokio runtime.
    ///
    /// The runtime is built once (lazily, on first tool call) and reused for
    /// every subsequent `tools/call`. This avoids the per-call allocation and
    /// thread-spin cost of creating a fresh `Runtime` on each request, and
    /// avoids the "cannot start a runtime from within a runtime" panic that
    /// would occur if `Runtime::new()` were invoked while already on a tokio
    /// worker thread.
    fn runtime(&self) -> &tokio::runtime::Handle {
        self.runtime
            .get_or_init(|| {
                tokio::runtime::Builder::new_multi_thread()
                    .enable_all()
                    .build()
                    .expect("failed to build MCP server tokio runtime")
            })
            .handle()
    }

    /// Start the MCP server (stdin/stdout communication)
    pub fn start(&mut self) -> Result<(), Box<dyn std::error::Error>> {
        let stdin = io::stdin();
        let stdout = io::stdout();
        let mut reader = BufReader::new(stdin);
        let mut writer = stdout.lock();

        // Server is now ready
        eprintln!("MCP Server started on stdin/stdout");

        loop {
            let mut line = String::new();
            reader.read_line(&mut line)?;

            if line.trim().is_empty() {
                continue;
            }

            let request: JsonRpcRequest = match serde_json::from_str(&line) {
                Ok(req) => req,
                Err(_e) => {
                    let error_response = JsonRpcResponse {
                        jsonrpc: "2.0".to_string(),
                        id: serde_json::json!(null),
                        result: None,
                        error: Some(JsonRpcError::parse_error()),
                    };
                    writeln!(writer, "{}", serde_json::to_string(&error_response)?)?;
                    continue;
                }
            };

            let response = self.handle_request(&request);
            writeln!(writer, "{}", serde_json::to_string(&response)?)?;
            writer.flush()?;
        }
    }

    /// Handle an incoming JSON-RPC request
    fn handle_request(&mut self, request: &JsonRpcRequest) -> JsonRpcResponse {
        let result = match request.method.as_str() {
            "initialize" => self.handle_initialize(request.params.as_ref()),
            "ping" => self.handle_ping(),
            "tools/list" => self.handle_tools_list(),
            "tools/call" => self.handle_tools_call(request.params.as_ref()),
            _ => Err(JsonRpcError::method_not_found()),
        };

        match result {
            Ok(result_value) => JsonRpcResponse {
                jsonrpc: "2.0".to_string(),
                id: request.id.clone(),
                result: Some(result_value),
                error: None,
            },
            Err(error) => JsonRpcResponse {
                jsonrpc: "2.0".to_string(),
                id: request.id.clone(),
                result: None,
                error: Some(error),
            },
        }
    }

    /// Handle initialize request
    fn handle_initialize(
        &self,
        _params: Option<&serde_json::Value>,
    ) -> Result<serde_json::Value, JsonRpcError> {
        Ok(json!({
            "protocolVersion": self.info.protocol_version,
            "capabilities": self.capabilities,
            "serverInfo": {
                "name": self.info.name,
                "version": self.info.version
            }
        }))
    }

    /// Handle ping request
    fn handle_ping(&self) -> Result<serde_json::Value, JsonRpcError> {
        Ok(json!({}))
    }

    /// Handle tools/list request
    fn handle_tools_list(&self) -> Result<serde_json::Value, JsonRpcError> {
        let tools = self.tool_registry.get_tools();
        Ok(json!({
            "tools": tools
        }))
    }

    /// Handle tools/call request
    fn handle_tools_call(
        &self,
        params: Option<&serde_json::Value>,
    ) -> Result<serde_json::Value, JsonRpcError> {
        let params = params.ok_or(JsonRpcError::invalid_params())?;
        let name = params["name"]
            .as_str()
            .ok_or(JsonRpcError::invalid_params())?;
        let arguments = params.get("arguments").cloned().unwrap_or(json!({}));

        let result = self
            .runtime()
            .block_on(self.tool_registry.execute_tool(name, arguments))
            .map_err(|e| JsonRpcError {
                code: -32603,
                message: e,
                data: None,
            })?;

        Ok(json!(result))
    }
}
