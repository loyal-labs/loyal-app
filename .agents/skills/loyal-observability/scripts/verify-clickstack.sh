#!/usr/bin/env bash
set -euo pipefail

endpoint="${LOYAL_CLICKSTACK_MCP_URL:-https://loyal-clickstack.onrender.com/api/mcp}"

pass() {
  printf 'PASS: %s\n' "$1"
}

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

for command in curl node; do
  command -v "$command" >/dev/null 2>&1 || fail "missing required command: $command"
done

[[ -n "${LOYAL_CLICKSTACK_API_KEY:-}" ]] || fail "LOYAL_CLICKSTACK_API_KEY is not set"

mcp_call() {
  local payload="$1"

  curl --fail --silent --show-error \
    --request POST "$endpoint" \
    --header "Authorization: Bearer $LOYAL_CLICKSTACK_API_KEY" \
    --header 'Content-Type: application/json' \
    --header 'Accept: application/json, text/event-stream' \
    --data-binary "$payload"
}

extract_sse_data() {
  node -e '
    let input = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { input += chunk; });
    process.stdin.on("end", () => {
      const line = input.split(/\r?\n/).find((entry) => entry.startsWith("data: "));
      if (!line) process.exit(1);
      process.stdout.write(line.slice(6));
    });
  '
}

initialize_response="$(mcp_call '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"loyal-observability-verify","version":"1.0"}}}' | extract_sse_data)"
node -e '
  const response = JSON.parse(process.argv[1]);
  if (response.error || response.result?.serverInfo?.name !== "clickstack") process.exit(1);
' "$initialize_response" || fail "ClickStack MCP initialize failed"
pass "ClickStack MCP initialized"

tools_response="$(mcp_call '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' | extract_sse_data)"
node -e '
  const response = JSON.parse(process.argv[1]);
  const names = new Set((response.result?.tools ?? []).map((tool) => tool.name));
  for (const required of ["clickstack_list_sources", "clickstack_describe_source", "clickstack_search", "clickstack_event_patterns"]) {
    if (!names.has(required)) process.exit(1);
  }
' "$tools_response" || fail "required read-only ClickStack tools are unavailable"
pass "read-only investigation tools are available"

sources_response="$(mcp_call '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"clickstack_list_sources","arguments":{}}}' | extract_sse_data)"
logs_source_id="$(node -e '
  const response = JSON.parse(process.argv[1]);
  if (response.error || response.result?.isError) process.exit(1);
  const content = response.result?.content?.find((item) => item.type === "text")?.text;
  const sources = JSON.parse(content).sources ?? [];
  const names = new Set(sources.map((source) => source.name));
  for (const required of ["Logs", "Traces", "Metrics", "Sessions"]) {
    if (!names.has(required)) process.exit(1);
  }
  const logs = sources.find((source) => source.name === "Logs");
  if (!logs?.id) process.exit(1);
  process.stdout.write(logs.id);
' "$sources_response")" || fail "ClickStack source discovery failed"
pass "Logs, Traces, Metrics, and Sessions sources are available"

end_time="$(node -e 'process.stdout.write(new Date().toISOString())')"
start_time="$(node -e 'process.stdout.write(new Date(Date.now() - 5 * 60 * 1000).toISOString())')"
search_payload="$(node -e '
  process.stdout.write(JSON.stringify({
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: {
      name: "clickstack_search",
      arguments: {
        sourceId: process.argv[1],
        startTime: process.argv[2],
        endTime: process.argv[3],
        where: "1 = 1",
        whereLanguage: "sql",
        columns: "Timestamp,ServiceName,SeverityText,Body",
        maxResults: 1
      }
    }
  }));
' "$logs_source_id" "$start_time" "$end_time")"
search_response="$(mcp_call "$search_payload" | extract_sse_data)"
node -e '
  const response = JSON.parse(process.argv[1]);
  if (response.error || response.result?.isError) process.exit(1);
  const content = response.result?.content?.find((item) => item.type === "text")?.text;
  const result = JSON.parse(content).result;
  if (!result || !Array.isArray(result.data)) process.exit(1);
' "$search_response" || fail "bounded five-minute ClickStack log query failed"
pass "bounded five-minute log query succeeded"
