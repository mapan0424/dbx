package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"
	"testing"
)

func TestHandshakeResponse(t *testing.T) {
	s := newServer()
	resp, shutdown := s.handleLine(`{"jsonrpc":"2.0","id":7,"method":"handshake","params":{"appVersion":"dev"}}`)
	if shutdown {
		t.Fatal("handshake should not shut down the server")
	}
	if resp.Error != nil {
		t.Fatalf("unexpected error: %v", resp.Error)
	}
	data, err := json.Marshal(resp.Result)
	if err != nil {
		t.Fatal(err)
	}
	var result struct {
		ProtocolVersion      int      `json:"protocolVersion"`
		AgentProtocolVersion int      `json:"agentProtocolVersion"`
		Capabilities         []string `json:"capabilities"`
	}
	if err := json.Unmarshal(data, &result); err != nil {
		t.Fatal(err)
	}
	if result.ProtocolVersion != 1 || result.AgentProtocolVersion != 1 {
		t.Fatalf("unexpected protocol versions: %+v", result)
	}
	contract := protocolContract(t)
	if result.ProtocolVersion != contract.ProtocolVersion || result.AgentProtocolVersion != contract.ProtocolVersion {
		t.Fatalf("handshake protocol versions do not match contract: result=%+v contract=%+v", result, contract)
	}
	for _, capability := range result.Capabilities {
		if !contains(contract.AllCapabilities, capability) {
			t.Fatalf("handshake returned capability %q outside protocol contract %v", capability, contract.AllCapabilities)
		}
	}
	if !contains(result.Capabilities, "query") || !contains(result.Capabilities, "metadata") {
		t.Fatalf("expected query and metadata capabilities, got %v", result.Capabilities)
	}
}

func TestRuntimeHandshakeAdvertisesMultiSessionProtocol(t *testing.T) {
	runtime := newRuntimeServer()
	resp, shutdown := runtime.handleLine(`{"jsonrpc":"2.0","id":7,"method":"handshake","params":{}}`)
	if shutdown || resp.Error != nil {
		t.Fatalf("unexpected handshake response: shutdown=%v error=%v", shutdown, resp.Error)
	}
	data, err := json.Marshal(resp.Result)
	if err != nil {
		t.Fatal(err)
	}
	var result struct {
		ProtocolVersion int      `json:"protocolVersion"`
		Capabilities    []string `json:"capabilities"`
	}
	if err := json.Unmarshal(data, &result); err != nil {
		t.Fatal(err)
	}
	if result.ProtocolVersion != multiSessionProtocolVersion || !contains(result.Capabilities, "multi_session") {
		t.Fatalf("unexpected runtime handshake: %+v", result)
	}
}

func TestRuntimeMissingAgentSessionDoesNotUseQueryCursorSessionID(t *testing.T) {
	runtime := newRuntimeServer()
	resp, shutdown := runtime.handleLine(`{"jsonrpc":"2.0","id":8,"method":"fetch_query_page","params":{"sessionId":"cursor-1"}}`)
	if shutdown {
		t.Fatal("fetch_query_page should not shut down the runtime")
	}
	if resp.Error == nil || !strings.Contains(resp.Error.Message, legacyAgentSessionID) {
		t.Fatalf("expected missing legacy agent session error, got %#v", resp.Error)
	}
}

func TestRuntimeCloseOneSessionKeepsOtherSessionRegistered(t *testing.T) {
	runtime := newRuntimeServer()
	runtime.sessions["a"] = &agentSession{server: newServer()}
	runtime.sessions["b"] = &agentSession{server: newServer()}

	if err := runtime.closeSession("a"); err != nil {
		t.Fatal(err)
	}
	if _, err := runtime.session("a"); err == nil {
		t.Fatal("closed session should be removed")
	}
	if _, err := runtime.session("b"); err != nil {
		t.Fatalf("other session should remain registered: %v", err)
	}
}

func TestRuntimeCancelSessionOnlyCancelsTargetSession(t *testing.T) {
	runtime := newRuntimeServer()
	serverA := newServer()
	serverB := newServer()
	ctxA, cancelA := context.WithCancel(context.Background())
	ctxB, cancelB := context.WithCancel(context.Background())
	serverA.activeCancel = cancelA
	serverB.activeCancel = cancelB
	runtime.sessions["a"] = &agentSession{server: serverA}
	runtime.sessions["b"] = &agentSession{server: serverB}

	resp, shutdown := runtime.handleLine(`{"jsonrpc":"2.0","id":9,"method":"cancel_session","params":{"agentSessionId":"a"}}`)
	if shutdown || resp.Error != nil {
		t.Fatalf("unexpected cancel response: shutdown=%v error=%v", shutdown, resp.Error)
	}
	select {
	case <-ctxA.Done():
	default:
		t.Fatal("target session was not canceled")
	}
	select {
	case <-ctxB.Done():
		t.Fatal("canceling session a should not cancel session b")
	default:
	}
	cancelB()
}

func TestRuntimeRejectsSessionsBeyondLimit(t *testing.T) {
	runtime := newRuntimeServer()
	for index := 0; index < maxAgentSessions; index++ {
		runtime.sessions[fmt.Sprintf("session-%d", index)] = &agentSession{server: newServer()}
	}
	err := runtime.openSession("overflow", connectParams{})
	if err == nil || !strings.Contains(err.Error(), "session limit") {
		t.Fatalf("expected session limit error, got %v", err)
	}
}

func TestNewXuguDatabaseSessionFindsOnlyNewSession(t *testing.T) {
	existing := xuguDatabaseSession{nodeID: 1, sessionID: 10}
	created := xuguDatabaseSession{nodeID: 1, sessionID: 11}
	result, err := newXuguDatabaseSession(
		map[xuguDatabaseSession]struct{}{existing: {}},
		map[xuguDatabaseSession]struct{}{existing: {}, created: {}},
	)
	if err != nil {
		t.Fatal(err)
	}
	if result != created {
		t.Fatalf("unexpected session: %+v", result)
	}
}

func TestXuguSessionAppNameIsStableAndDoesNotExposeSessionID(t *testing.T) {
	name := xuguSessionAppName("tab-session-secret")
	if name != xuguSessionAppName("tab-session-secret") {
		t.Fatal("app name should be stable")
	}
	if strings.Contains(name, "tab-session-secret") || !strings.HasPrefix(name, "DBX_") {
		t.Fatalf("unexpected app name: %s", name)
	}
}

func TestCloseMissingQuerySessionReturnsFalse(t *testing.T) {
	s := newServer()
	resp, shutdown := s.handleLine(`{"jsonrpc":"2.0","id":8,"method":"close_query_session","params":{"sessionId":"missing"}}`)
	if shutdown {
		t.Fatal("close_query_session should not shut down the server")
	}
	if resp.Error != nil {
		t.Fatalf("unexpected error: %v", resp.Error)
	}
	if resp.Result != false {
		t.Fatalf("expected false result, got %#v", resp.Result)
	}
}

func TestListDataTypesReturnsXuguTypes(t *testing.T) {
	s := newServer()
	resp, shutdown := s.handleLine(`{"jsonrpc":"2.0","id":9,"method":"list_data_types","params":{"database":"demo"}}`)
	if shutdown {
		t.Fatal("list_data_types should not shut down the server")
	}
	if resp.Error != nil {
		t.Fatalf("unexpected error: %v", resp.Error)
	}
	data, err := json.Marshal(resp.Result)
	if err != nil {
		t.Fatal(err)
	}
	var result []string
	if err := json.Unmarshal(data, &result); err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"INTEGER", "VARCHAR", "NUMERIC", "INT"} {
		if !contains(result, want) {
			t.Fatalf("expected data type %q in %v", want, result)
		}
	}
}

func TestEmptyResultSlicesMarshalAsArrays(t *testing.T) {
	data, err := json.Marshal(queryResult{})
	if err != nil {
		t.Fatal(err)
	}
	text := string(data)
	if strings.Contains(text, `"columns":null`) || strings.Contains(text, `"column_types":null`) || strings.Contains(text, `"rows":null`) {
		t.Fatalf("query result should marshal nil slices as arrays: %s", text)
	}

	data, err = json.Marshal(indexInfo{})
	if err != nil {
		t.Fatal(err)
	}
	text = string(data)
	if strings.Contains(text, `"columns":null`) || strings.Contains(text, `"included_columns":null`) {
		t.Fatalf("index info should marshal nil slices as arrays: %s", text)
	}
}

func TestGetTableDDLResultMarshalsAsString(t *testing.T) {
	data, err := json.Marshal("CREATE TABLE SYSDBA.ORDERS (ID INT)")
	if err != nil {
		t.Fatal(err)
	}
	var ddl string
	if err := json.Unmarshal(data, &ddl); err != nil {
		t.Fatalf("get_table_ddl result must deserialize as a string: %v", err)
	}
}

func TestBuildDSNUsesConnectionStringWhenProvided(t *testing.T) {
	dsn := buildDSN(connectParams{ConnectionString: "IP=db.example.com;DB=SYSTEM;User=SYSDBA;PWD=secret;Port=5138"})

	if dsn != "IP=db.example.com;DB=SYSTEM;User=SYSDBA;PWD=secret;Port=5138" {
		t.Fatalf("unexpected dsn: %s", dsn)
	}
}

func protocolContract(t *testing.T) struct {
	ProtocolVersion int      `json:"protocolVersion"`
	AllCapabilities []string `json:"allCapabilities"`
} {
	t.Helper()
	data, err := os.ReadFile("../../common/src/main/resources/agent-protocol-v1.json")
	if err != nil {
		t.Fatal(err)
	}
	var contract struct {
		ProtocolVersion int      `json:"protocolVersion"`
		AllCapabilities []string `json:"allCapabilities"`
	}
	if err := json.Unmarshal(data, &contract); err != nil {
		t.Fatal(err)
	}
	return contract
}

func TestBuildDSNUsesConnectionFields(t *testing.T) {
	dsn := buildDSN(connectParams{
		Host:     "db.example.com",
		Port:     15138,
		Database: "demo",
		Username: "sysdba",
		Password: "secret",
	})

	for _, part := range []string{"IP=db.example.com", "DB=demo", "User=sysdba", "PWD=secret", "Port=15138"} {
		if !strings.Contains(dsn, part) {
			t.Fatalf("dsn should contain %s, got: %s", part, dsn)
		}
	}
}

func TestXuguLiveMetadataIntegration(t *testing.T) {
	username := strings.TrimSpace(os.Getenv("XUGU_INTEGRATION_USERNAME"))
	password := os.Getenv("XUGU_INTEGRATION_PASSWORD")
	if username == "" || password == "" {
		t.Skip("set XUGU_INTEGRATION_USERNAME and XUGU_INTEGRATION_PASSWORD to run against a local XuguDB instance")
	}
	port := 5138
	if rawPort := strings.TrimSpace(os.Getenv("XUGU_INTEGRATION_PORT")); rawPort != "" {
		parsedPort, err := strconv.Atoi(rawPort)
		if err != nil {
			t.Fatalf("parse XUGU_INTEGRATION_PORT: %v", err)
		}
		port = parsedPort
	}
	host := strings.TrimSpace(os.Getenv("XUGU_INTEGRATION_HOST"))
	if host == "" {
		host = "127.0.0.1"
	}
	database := strings.TrimSpace(os.Getenv("XUGU_INTEGRATION_DATABASE"))
	if database == "" {
		database = "SYSTEM"
	}

	server := newServer()
	if err := server.connect(connectParams{Host: host, Port: port, Database: database, Username: username, Password: password}); err != nil {
		t.Fatalf("connect to XuguDB: %v", err)
	}
	t.Cleanup(func() { _ = server.disconnect() })

	databases, err := server.listDatabases()
	if err != nil {
		t.Fatalf("list databases: %v", err)
	}
	if len(databases) == 0 {
		t.Fatal("expected at least one database")
	}

	schemas, err := server.listSchemas()
	if err != nil {
		t.Fatalf("list schemas: %v", err)
	}
	if len(schemas) == 0 {
		t.Fatal("expected at least one schema")
	}

	t.Logf("databases=%d schemas=%d", len(databases), len(schemas))
	checkedSourceTypes := map[string]bool{}
	skippedSourceTypes := map[string]int{}
	var tableSchema, tableName string
	for _, schema := range schemas {
		objects, err := server.listObjects(schema, metadataListConstraints{})
		if err != nil {
			t.Fatalf("list objects for %s: %v", schema, err)
		}
		t.Logf("schema=%s objects=%d", schema, len(objects))
		for _, object := range objects {
			if object.ObjectType == "TABLE" && tableName == "" {
				tableSchema = schema
				tableName = object.Name
			}
			if object.ObjectType == "TABLE" || checkedSourceTypes[object.ObjectType] {
				continue
			}
			source, err := server.getObjectSource(schema, object.Name, object.ObjectType)
			if err != nil {
				// Administrative schemas can list definitions whose source is not
				// readable by this session. Continue so the integration check can
				// still exercise accessible application schemas.
				skippedSourceTypes[object.ObjectType]++
				continue
			}
			if strings.TrimSpace(fmt.Sprint(source["source"])) == "" {
				t.Fatalf("expected non-empty %s source for %s.%s", object.ObjectType, schema, object.Name)
			}
			t.Logf("source=%s %s.%s", object.ObjectType, schema, object.Name)
			checkedSourceTypes[object.ObjectType] = true
		}
	}
	t.Logf("source kinds read=%v skipped_for_permissions=%v", checkedSourceTypes, skippedSourceTypes)
	if tableName == "" {
		t.Fatal("expected at least one table for metadata validation")
	}
	columns, err := server.getColumns(tableSchema, tableName)
	if err != nil {
		t.Fatalf("get columns for %s.%s: %v", tableSchema, tableName, err)
	}
	if len(columns) == 0 {
		t.Fatalf("expected columns for %s.%s", tableSchema, tableName)
	}
	ddl, err := server.getTableDDL(tableSchema, tableName)
	if err != nil {
		t.Fatalf("get DDL for %s.%s: %v", tableSchema, tableName, err)
	}
	if strings.TrimSpace(ddl) == "" {
		t.Fatalf("expected DDL for %s.%s", tableSchema, tableName)
	}
	indexes, err := server.listIndexes(tableSchema, tableName)
	if err != nil {
		t.Fatalf("list indexes for %s.%s: %v", tableSchema, tableName, err)
	}
	foreignKeys, err := server.listForeignKeys(tableSchema, tableName)
	if err != nil {
		t.Fatalf("list foreign keys for %s.%s: %v", tableSchema, tableName, err)
	}
	triggers, err := server.listTriggers(tableSchema, tableName)
	if err != nil {
		t.Fatalf("list triggers for %s.%s: %v", tableSchema, tableName, err)
	}
	t.Logf("table=%s.%s columns=%d indexes=%d foreign_keys=%d triggers=%d", tableSchema, tableName, len(columns), len(indexes), len(foreignKeys), len(triggers))

	rows, err := server.queryRows(`
SELECT SYNO_NAME, TARG_SCHE_ID, TARG_NAME, IS_PUBLIC
FROM SYS_SYNONYMS
WHERE ROWNUM <= 1`, nil)
	if err != nil {
		t.Fatalf("query SYS_SYNONYMS dictionary: %v", err)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("read SYS_SYNONYMS dictionary: %v", err)
	}
	if err := server.closeRows(rows); err != nil {
		t.Fatalf("close SYS_SYNONYMS dictionary rows: %v", err)
	}

	jobRows, err := server.queryRows(`
SELECT j.JOB_ID, j.USER_ID, u.USER_NAME AS OWNER, j.JOB_NAME, j.JOB_TYPE,
       TO_CHAR(j.JOB_ACTION) AS JOB_ACTION, j.JOB_PARAM_NUM, j.BEGIN_T, j.END_T,
       j.REPET_INTERVAL, j.TRIG_EVENTS, j.LAST_RUN_T, j.STATE, j.ENABLE,
       j.AUTO_DROP, j.IS_SYS, j.COMMENTS
FROM ALL_JOBS j
LEFT JOIN ALL_USERS u ON u.DB_ID = j.DB_ID AND u.USER_ID = j.USER_ID
WHERE j.DB_ID = (SELECT d.DB_ID FROM ALL_DATABASES d WHERE UPPER(d.DB_NAME) = UPPER(?))
ORDER BY j.JOB_NAME`, []any{database})
	if err != nil {
		t.Fatalf("query ALL_JOBS dictionary: %v", err)
	}
	if err := jobRows.Err(); err != nil {
		t.Fatalf("read ALL_JOBS dictionary: %v", err)
	}
	if err := server.closeRows(jobRows); err != nil {
		t.Fatalf("close ALL_JOBS dictionary rows: %v", err)
	}

	userRows, err := server.queryRows(`
SELECT
  USER_NAME AS username,
  '' AS host,
  FALSE AS is_role,
  CASE WHEN LOCKED THEN 'LOCKED' ELSE 'ACTIVE' END ||
    CASE WHEN EXPIRED THEN ' · EXPIRED' ELSE '' END ||
    CASE WHEN IS_SYS THEN ' · SYSTEM' ELSE '' END AS plugin
FROM DBA_USERS
WHERE IS_ROLE = FALSE
UNION ALL
SELECT
  USER_NAME AS username,
  '' AS host,
  TRUE AS is_role,
  CASE WHEN IS_SYS THEN 'SYSTEM ROLE' ELSE 'ROLE' END AS plugin
FROM DBA_ROLES
ORDER BY USER_NAME`, nil)
	if err != nil {
		t.Fatalf("query DBA_USERS dictionary: %v", err)
	}
	if err := userRows.Err(); err != nil {
		t.Fatalf("read DBA_USERS dictionary: %v", err)
	}
	if err := server.closeRows(userRows); err != nil {
		t.Fatalf("close DBA_USERS dictionary rows: %v", err)
	}

	grantRows, err := server.queryRows(`
SELECT line
FROM (
  SELECT 1 AS sort, 'User: ' || u.USER_NAME AS line
  FROM DBA_USERS u
  WHERE UPPER(u.USER_NAME) = UPPER(?)
  UNION ALL
  SELECT 10, 'Role: ' || r.USER_NAME
  FROM DBA_ROLE_MEMBERS m
  JOIN DBA_USERS u ON u.DB_ID = m.DB_ID AND u.USER_ID = m.USER_ID
  JOIN DBA_ROLES r ON r.DB_ID = m.DB_ID AND r.USER_ID = m.ROLE_ID
  WHERE UPPER(u.USER_NAME) = UPPER(?)
  UNION ALL
  SELECT 20, 'ACL: object_type=' || TO_CHAR(a.OBJECT_TYPE) ||
    ', object_id=' || TO_CHAR(a.OBJECT_ID) ||
    ', authority=' || TO_CHAR(a.AUTHORITY) ||
    CASE WHEN a.REGRANT <> 0 THEN ' WITH GRANT OPTION' ELSE '' END
  FROM DBA_ACLS a
  JOIN DBA_USERS u ON u.DB_ID = a.DB_ID AND u.USER_ID = a.GRANTEE_ID
  WHERE UPPER(u.USER_NAME) = UPPER(?)
) grants
ORDER BY sort, line`, []any{username, username, username})
	if err != nil {
		t.Fatalf("query Xugu user grants dictionary: %v", err)
	}
	if err := grantRows.Err(); err != nil {
		t.Fatalf("read Xugu user grants dictionary: %v", err)
	}
	if err := server.closeRows(grantRows); err != nil {
		t.Fatalf("close Xugu user grants dictionary rows: %v", err)
	}

	versionRows, err := server.queryRows("SELECT VERSION() AS VERSION FROM DUAL", nil)
	if err != nil {
		t.Fatalf("query Xugu VERSION(): %v", err)
	}
	if err := versionRows.Err(); err != nil {
		t.Fatalf("read Xugu VERSION(): %v", err)
	}
	if err := server.closeRows(versionRows); err != nil {
		t.Fatalf("close Xugu VERSION() rows: %v", err)
	}

	clusterRows, err := server.queryRows(`
SELECT NODE_ID, RACK_NO, NODE_IP, NODE_PORT, NODE_TYPE, NODE_STATE,
       CPU_LOAD, BOOT_TIME, STORE_NUM, MAJOR_NUM
FROM SYS_CLUSTERS
ORDER BY NODE_ID`, nil)
	if err != nil {
		t.Fatalf("query SYS_CLUSTERS dictionary: %v", err)
	}
	if err := clusterRows.Err(); err != nil {
		t.Fatalf("read SYS_CLUSTERS dictionary: %v", err)
	}
	if err := server.closeRows(clusterRows); err != nil {
		t.Fatalf("close SYS_CLUSTERS dictionary rows: %v", err)
	}

	runInfoRows, err := server.queryRows(`
SELECT NODEID, CURR_T, REQ_N, ACT_TRANS_NUM, LOCK_WAIT_N,
       DISK_R_BYTES, DISK_W_BYTES, NET_R_BYTES, NET_W_BYTES,
       S_LOCK_N, X_LOCK_N, DELAY_STO_N, DROPED_STO_N, FREE_STO_N
FROM SYS_ALL_RUN_INFO
ORDER BY NODEID`, nil)
	if err != nil {
		t.Fatalf("query SYS_ALL_RUN_INFO dictionary: %v", err)
	}
	if err := runInfoRows.Err(); err != nil {
		t.Fatalf("read SYS_ALL_RUN_INFO dictionary: %v", err)
	}
	if err := server.closeRows(runInfoRows); err != nil {
		t.Fatalf("close SYS_ALL_RUN_INFO dictionary rows: %v", err)
	}

	argumentRows, err := server.queryRows(`
SELECT PROC_NAME, TO_CHAR(DEFINE)
FROM ALL_PROCEDURES
WHERE RET_TYPE IS NULL AND ROWNUM <= 1`, nil)
	if err != nil {
		t.Fatalf("query ALL_PROCEDURES definition dictionary: %v", err)
	}
	defer server.closeRows(argumentRows)
	if err := argumentRows.Err(); err != nil {
		t.Fatalf("read ALL_PROCEDURES definition dictionary: %v", err)
	}
}

func TestXuguLiveTypeSourceIntegration(t *testing.T) {
	username := strings.TrimSpace(os.Getenv("XUGU_INTEGRATION_USERNAME"))
	password := os.Getenv("XUGU_INTEGRATION_PASSWORD")
	if username == "" || password == "" {
		t.Skip("set XUGU_INTEGRATION_USERNAME and XUGU_INTEGRATION_PASSWORD to run against a local XuguDB instance")
	}
	port := 5138
	if rawPort := strings.TrimSpace(os.Getenv("XUGU_INTEGRATION_PORT")); rawPort != "" {
		parsedPort, err := strconv.Atoi(rawPort)
		if err != nil {
			t.Fatalf("parse XUGU_INTEGRATION_PORT: %v", err)
		}
		port = parsedPort
	}
	host := strings.TrimSpace(os.Getenv("XUGU_INTEGRATION_HOST"))
	if host == "" {
		host = "127.0.0.1"
	}
	database := strings.TrimSpace(os.Getenv("XUGU_INTEGRATION_DATABASE"))
	if database == "" {
		database = "SYSTEM"
	}
	schema := strings.TrimSpace(os.Getenv("XUGU_INTEGRATION_TYPE_SCHEMA"))
	if schema == "" {
		schema = "tibms_sx_agent"
	}

	server := newServer()
	if err := server.connect(connectParams{Host: host, Port: port, Database: database, Username: username, Password: password}); err != nil {
		t.Fatalf("connect to XuguDB: %v", err)
	}
	t.Cleanup(func() { _ = server.disconnect() })

	objects, err := server.listObjects(schema, metadataListConstraints{ObjectTypes: []string{"TYPE"}, Limit: 1})
	if err != nil {
		t.Fatalf("list TYPE objects for %s: %v", schema, err)
	}
	if len(objects) == 0 {
		t.Fatalf("expected at least one TYPE object in %s", schema)
	}
	object := objects[0]
	if object.ObjectType != "TYPE" {
		t.Fatalf("expected TYPE object, got %#v", object)
	}
	source, err := server.getObjectSource(schema, object.Name, "TYPE")
	if err != nil {
		t.Fatalf("get TYPE source for %s.%s: %v", schema, object.Name, err)
	}
	if !strings.Contains(fmt.Sprint(source["source"]), "XuguDB did not expose the definition") {
		t.Fatalf("expected unavailable TYPE source notice for %s.%s, got: %#v", schema, object.Name, source)
	}
	if editable, ok := source["editable"].(bool); !ok || editable {
		t.Fatalf("unavailable TYPE source must be read-only, got: %#v", source)
	}
	t.Logf("type source=%s.%s", schema, object.Name)
}

func TestXuguLiveRoutineSourceIntegration(t *testing.T) {
	username := strings.TrimSpace(os.Getenv("XUGU_INTEGRATION_USERNAME"))
	password := os.Getenv("XUGU_INTEGRATION_PASSWORD")
	if username == "" || password == "" {
		t.Skip("set XUGU_INTEGRATION_USERNAME and XUGU_INTEGRATION_PASSWORD to run against a local XuguDB instance")
	}
	port := 5138
	if rawPort := strings.TrimSpace(os.Getenv("XUGU_INTEGRATION_PORT")); rawPort != "" {
		parsedPort, err := strconv.Atoi(rawPort)
		if err != nil {
			t.Fatalf("parse XUGU_INTEGRATION_PORT: %v", err)
		}
		port = parsedPort
	}
	host := strings.TrimSpace(os.Getenv("XUGU_INTEGRATION_HOST"))
	if host == "" {
		host = "127.0.0.1"
	}
	database := strings.TrimSpace(os.Getenv("XUGU_INTEGRATION_DATABASE"))
	if database == "" {
		database = "SYSTEM"
	}
	schema := strings.TrimSpace(os.Getenv("XUGU_INTEGRATION_ROUTINE_SCHEMA"))
	if schema == "" {
		schema = "tibms_sx_agent"
	}

	server := newServer()
	if err := server.connect(connectParams{Host: host, Port: port, Database: database, Username: username, Password: password}); err != nil {
		t.Fatalf("connect to XuguDB: %v", err)
	}
	t.Cleanup(func() { _ = server.disconnect() })

	for _, objectType := range []string{"FUNCTION", "PROCEDURE"} {
		objects, err := server.listObjects(schema, metadataListConstraints{ObjectTypes: []string{objectType}, Limit: 1})
		if err != nil {
			t.Fatalf("list %s objects for %s: %v", objectType, schema, err)
		}
		if len(objects) == 0 {
			continue
		}
		object := objects[0]
		source, err := server.getObjectSource(schema, object.Name, objectType)
		if err != nil {
			t.Fatalf("get %s source for %s.%s: %v", objectType, schema, object.Name, err)
		}
		definition := strings.TrimSpace(fmt.Sprint(source["source"]))
		if definition == "" || !strings.Contains(strings.ToUpper(definition), "CREATE") {
			t.Fatalf("expected %s definition for %s.%s, got: %#v", objectType, schema, object.Name, source)
		}
		t.Logf("%s source=%s.%s", strings.ToLower(objectType), schema, object.Name)
		return
	}
	t.Fatalf("expected at least one function or procedure in %s", schema)
}

func TestXuguLiveViewMetadataIntegration(t *testing.T) {
	username := strings.TrimSpace(os.Getenv("XUGU_INTEGRATION_USERNAME"))
	password := os.Getenv("XUGU_INTEGRATION_PASSWORD")
	if username == "" || password == "" {
		t.Skip("set XUGU_INTEGRATION_USERNAME and XUGU_INTEGRATION_PASSWORD to run against a local XuguDB instance")
	}
	port := 5138
	if rawPort := strings.TrimSpace(os.Getenv("XUGU_INTEGRATION_PORT")); rawPort != "" {
		parsedPort, err := strconv.Atoi(rawPort)
		if err != nil {
			t.Fatalf("parse XUGU_INTEGRATION_PORT: %v", err)
		}
		port = parsedPort
	}
	host := strings.TrimSpace(os.Getenv("XUGU_INTEGRATION_HOST"))
	if host == "" {
		host = "127.0.0.1"
	}
	database := strings.TrimSpace(os.Getenv("XUGU_INTEGRATION_DATABASE"))
	if database == "" {
		database = "SYSTEM"
	}
	schema := strings.TrimSpace(os.Getenv("XUGU_INTEGRATION_VIEW_SCHEMA"))
	if schema == "" {
		schema = "tibms_sx_business"
	}
	view := strings.TrimSpace(os.Getenv("XUGU_INTEGRATION_VIEW_NAME"))
	if view == "" {
		view = "V_CardUnit"
	}

	server := newServer()
	if err := server.connect(connectParams{Host: host, Port: port, Database: database, Username: username, Password: password}); err != nil {
		t.Fatalf("connect to XuguDB: %v", err)
	}
	t.Cleanup(func() { _ = server.disconnect() })

	columns, err := server.getColumns(schema, view)
	if err != nil {
		t.Fatalf("get view columns for %s.%s: %v", schema, view, err)
	}
	if len(columns) == 0 {
		t.Fatalf("expected view columns for %s.%s", schema, view)
	}
	source, err := server.getObjectSource(schema, view, "VIEW")
	if err != nil {
		t.Fatalf("get view source for %s.%s: %v", schema, view, err)
	}
	if !strings.Contains(strings.ToUpper(fmt.Sprint(source["source"])), "CREATE") {
		t.Fatalf("expected view DDL source for %s.%s, got: %#v", schema, view, source)
	}
	ddl, err := server.getTableDDL(schema, view)
	if err != nil {
		t.Fatalf("get view DDL for %s.%s: %v", schema, view, err)
	}
	if !strings.Contains(strings.ToUpper(ddl), "CREATE") {
		t.Fatalf("expected view DDL for %s.%s, got: %s", schema, view, ddl)
	}
	t.Logf("view=%s.%s columns=%d", schema, view, len(columns))
}

func TestBuildDSNUsesDefaultPort(t *testing.T) {
	dsn := buildDSN(connectParams{
		Host:     "db.example.com",
		Database: "demo",
		Username: "sysdba",
		Password: "secret",
	})

	if !strings.Contains(dsn, "Port=5138") {
		t.Fatalf("dsn should default to Xugu port, got: %s", dsn)
	}
}

func TestBuildDSNParsesJdbcURL(t *testing.T) {
	dsn := buildDSN(connectParams{
		Username:         "sysdba",
		Password:         "secret",
		ConnectionString: "jdbc:xugu://db.example.com:15138/demo",
	})

	for _, part := range []string{"IP=db.example.com", "DB=demo", "User=sysdba", "PWD=secret", "Port=15138"} {
		if !strings.Contains(dsn, part) {
			t.Fatalf("dsn should contain %s, got: %s", part, dsn)
		}
	}
}

func TestBuildDSNParsesDBXURL(t *testing.T) {
	dsn := buildDSN(connectParams{
		ConnectionString: "xugu://sysdba:secret@db.example.com:15138/demo",
	})

	for _, part := range []string{"IP=db.example.com", "DB=demo", "User=sysdba", "PWD=secret", "Port=15138"} {
		if !strings.Contains(dsn, part) {
			t.Fatalf("dsn should contain %s, got: %s", part, dsn)
		}
	}
}

func TestBuildDSNAppendsURLParams(t *testing.T) {
	dsn := buildDSN(connectParams{
		Host:      "db.example.com",
		Database:  "demo",
		Username:  "sysdba",
		Password:  "secret",
		URLParams: "AUTO_COMMIT=on;CHAR_SET=UTF8",
	})

	for _, part := range []string{"AUTO_COMMIT=on", "CHAR_SET=UTF8"} {
		if !strings.Contains(dsn, part) {
			t.Fatalf("dsn should contain %s, got: %s", part, dsn)
		}
	}
}

func TestBuildDSNDefaultsToUTF8(t *testing.T) {
	dsn := buildDSN(connectParams{
		Host:     "db.example.com",
		Database: "demo",
		Username: "sysdba",
		Password: "secret",
	})

	if !strings.Contains(dsn, "CHAR_SET=UTF8") {
		t.Fatalf("dsn should default to UTF8, got: %s", dsn)
	}
}

func TestBuildDSNRespectsExplicitCharset(t *testing.T) {
	dsn := buildDSN(connectParams{
		Host:      "db.example.com",
		Database:  "demo",
		Username:  "sysdba",
		Password:  "secret",
		URLParams: "CHAR_SET=GBK",
	})

	if strings.Contains(dsn, "CHAR_SET=UTF8") || !strings.Contains(dsn, "CHAR_SET=GBK") {
		t.Fatalf("dsn should respect explicit charset, got: %s", dsn)
	}
}

func TestListDatabasesSQLUsesXuguDictionary(t *testing.T) {
	sqlText := strings.ToUpper(xuguListDatabasesSQL)

	if !strings.Contains(sqlText, "ALL_DATABASES") || strings.Contains(sqlText, "SYS_DATABASES") {
		t.Fatalf("database listing should query low-privilege ALL_DATABASES, got: %s", xuguListDatabasesSQL)
	}
}

func TestFallbackDatabasesFromParams(t *testing.T) {
	cases := []struct {
		name   string
		params connectParams
		want   string
	}{
		{
			name: "database field",
			params: connectParams{
				Database: "LOWPRIV",
			},
			want: "LOWPRIV",
		},
		{
			name: "dbx url",
			params: connectParams{
				ConnectionString: "xugu://user:secret@db.example.com:5138/demo",
			},
			want: "demo",
		},
		{
			name: "jdbc url",
			params: connectParams{
				ConnectionString: "jdbc:xugu://db.example.com:5138/reporting",
			},
			want: "reporting",
		},
		{
			name: "native dsn",
			params: connectParams{
				ConnectionString: "IP=db.example.com;DB=SYSTEM;User=SYSDBA;PWD=secret;Port=5138",
			},
			want: "SYSTEM",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := fallbackDatabasesFromParams(tc.params)
			if len(got) != 1 || got[0].Name != tc.want {
				t.Fatalf("unexpected fallback databases: got=%v want=%s", got, tc.want)
			}
		})
	}
}

func TestUseDatabaseSkipsConfiguredDatabase(t *testing.T) {
	s := newServer()
	s.params = connectParams{Database: "SYSTEM"}

	if err := s.useDatabase("system"); err != nil {
		t.Fatalf("expected configured database USE to be skipped, got: %v", err)
	}
}

func TestConfiguredDatabaseName(t *testing.T) {
	cases := []struct {
		params connectParams
		want   string
	}{
		{params: connectParams{Database: "SYSTEM"}, want: "SYSTEM"},
		{params: connectParams{ConnectionString: "xugu://user:secret@db.example.com:5138/demo"}, want: "demo"},
		{params: connectParams{ConnectionString: "jdbc:xugu://db.example.com:5138/reporting"}, want: "reporting"},
		{params: connectParams{ConnectionString: "IP=db.example.com;DB=SYSTEM;User=SYSDBA;PWD=secret"}, want: "SYSTEM"},
	}

	for _, tc := range cases {
		if got := configuredDatabaseName(tc.params); got != tc.want {
			t.Fatalf("configuredDatabaseName(%+v) = %q, want %q", tc.params, got, tc.want)
		}
	}
}

func TestSchemaListingSQLUsesLowPrivilegeDictionary(t *testing.T) {
	sqlText := strings.ToUpper(xuguListSchemasSQL)

	if !strings.Contains(sqlText, "ALL_SCHEMAS") || strings.Contains(sqlText, "SYS_SCHEMAS") {
		t.Fatalf("schema listing should query low-privilege ALL_SCHEMAS, got: %s", xuguListSchemasSQL)
	}
}

func TestPrimaryKeySQLUsesLowPrivilegeDictionary(t *testing.T) {
	sqlText := strings.ToUpper(xuguPrimaryKeyColumnsSQL)

	for _, want := range []string{"ALL_CONSTRAINTS", "ALL_TABLES", "ALL_SCHEMAS"} {
		if !strings.Contains(sqlText, want) {
			t.Fatalf("primary key listing should query %s, got: %s", want, xuguPrimaryKeyColumnsSQL)
		}
	}
	for _, forbidden := range []string{"SYS_CONSTRAINTS", "SYS_TABLES", "SYS_SCHEMAS"} {
		if strings.Contains(sqlText, forbidden) {
			t.Fatalf("primary key listing should not query %s, got: %s", forbidden, xuguPrimaryKeyColumnsSQL)
		}
	}
}

func TestColumnSQLUsesLowPrivilegeDictionary(t *testing.T) {
	sqlText := strings.ToUpper(xuguListColumnsSQL)

	for _, want := range []string{"ALL_COLUMNS", "ALL_TABLES", "ALL_SCHEMAS", "COMMENTS", `"VARYING"`} {
		if !strings.Contains(sqlText, want) {
			t.Fatalf("column listing should query %s, got: %s", want, xuguListColumnsSQL)
		}
	}
	for _, forbidden := range []string{"SYS_COLUMNS", "SYS_TABLES", "SYS_SCHEMAS"} {
		if strings.Contains(sqlText, forbidden) {
			t.Fatalf("column listing should not query %s, got: %s", forbidden, xuguListColumnsSQL)
		}
	}
}

func TestViewColumnSQLUsesLowPrivilegeDictionary(t *testing.T) {
	sqlText := strings.ToUpper(xuguListViewColumnsSQL)

	for _, want := range []string{"ALL_VIEW_COLUMNS", "ALL_VIEWS", "ALL_SCHEMAS", "COMMENTS", `"VARYING"`} {
		if !strings.Contains(sqlText, want) {
			t.Fatalf("view column listing should query %s, got: %s", want, xuguListViewColumnsSQL)
		}
	}
	for _, forbidden := range []string{"SYS_VIEW_COLUMNS", "SYS_VIEWS", "SYS_SCHEMAS"} {
		if strings.Contains(sqlText, forbidden) {
			t.Fatalf("view column listing should not query %s, got: %s", forbidden, xuguListViewColumnsSQL)
		}
	}
}

func TestIndexSQLUsesLowPrivilegeDictionary(t *testing.T) {
	sqlText := strings.ToUpper(xuguListIndexesSQL)

	for _, want := range []string{"ALL_INDEXES", "ALL_TABLES", "ALL_SCHEMAS", "KEYS"} {
		if !strings.Contains(sqlText, want) {
			t.Fatalf("index listing should query %s, got: %s", want, xuguListIndexesSQL)
		}
	}
	for _, forbidden := range []string{"SYS_INDEXES", "SYS_TABLES", "SYS_SCHEMAS"} {
		if strings.Contains(sqlText, forbidden) {
			t.Fatalf("index listing should not query %s, got: %s", forbidden, xuguListIndexesSQL)
		}
	}
}

func TestXuguMetadataAccessErrorDetection(t *testing.T) {
	if !isXuguMetadataAccessError(errors.New("[E18012] 权限不够")) {
		t.Fatal("expected E18012 permission error to be treated as metadata access error")
	}
	if isXuguMetadataAccessError(errors.New("network timeout")) {
		t.Fatal("network errors should not trigger database-list fallback")
	}
}

func TestXuguListTablesQueryAppliesMetadataConstraints(t *testing.T) {
	query := xuguListTablesQuery("APP", metadataListConstraints{
		Filter:      "ord_",
		ObjectTypes: []string{"view", "table", "VIEW"},
		Limit:       25,
		Offset:      50,
	})

	for _, want := range []string{
		"UPPER(TABLE_NAME) LIKE ? ESCAPE '\\'",
		"TABLE_TYPE IN (?,?)",
		"ORDER BY TABLE_TYPE, TABLE_NAME",
		"ROWNUM <= ?",
		"DBX_RN > ?",
	} {
		if !strings.Contains(query.SQL, want) {
			t.Fatalf("expected SQL to contain %q:\n%s", want, query.SQL)
		}
	}

	wantArgs := []any{"APP", "APP", `%O%R%D%\_%`, "TABLE", "VIEW", 75, 50}
	assertArgs(t, query.Args, wantArgs)
}

func TestXuguListObjectsQueryRejectsUnsupportedObjectTypes(t *testing.T) {
	query := xuguListObjectsQuery("APP", metadataListConstraints{
		ObjectTypes: []string{"INDEX"},
		Limit:       10,
	})

	if !strings.Contains(query.SQL, "1 = 0") {
		t.Fatalf("unsupported object type should produce empty-result predicate:\n%s", query.SQL)
	}

	wantArgs := []any{"APP", "APP", "APP", "APP", "APP", "APP", "APP", "APP", "APP", "APP", 10, 0}
	assertArgs(t, query.Args, wantArgs)
}

func TestXuguListObjectsQueryIncludesProgrammableObjects(t *testing.T) {
	query := xuguListObjectsQuery("APP", metadataListConstraints{
		ObjectTypes: []string{"procedure", "function", "package", "package-body", "trigger", "sequence", "type", "type-body", "synonym"},
	})

	for _, want := range []string{"ALL_PROCEDURES", "p.VALID", "ALL_PACKAGES", "p.BODY IS NOT NULL", "ALL_TRIGGERS", "ALL_SEQUENCES", "ALL_TYPES", "u.BODY IS NOT NULL", "SYS_SYNONYMS", "y.IS_PUBLIC", "OBJECT_NAME, OBJECT_TYPE, COMMENTS, IS_PUBLIC, VALID", "OBJECT_TYPE IN (?,?,?,?,?,?,?,?,?)"} {
		if !strings.Contains(query.SQL, want) {
			t.Fatalf("expected SQL to contain %q:\n%s", want, query.SQL)
		}
	}

	wantArgs := []any{"APP", "APP", "APP", "APP", "APP", "APP", "APP", "APP", "APP", "APP", "FUNCTION", "PACKAGE", "PACKAGE_BODY", "PROCEDURE", "SEQUENCE", "SYNONYM", "TRIGGER", "TYPE", "TYPE_BODY"}
	assertArgs(t, query.Args, wantArgs)
}

func TestXuguTypeObjectSourceQueriesUseAccessibleTypeDictionary(t *testing.T) {
	for objectType, column := range map[string]string{"TYPE": "t.SPEC", "TYPE_BODY": "t.BODY"} {
		query, args, err := objectSourceQuery("APP", "ADDRESS_T", objectType)
		if err != nil {
			t.Fatalf("objectSourceQuery(%s): %v", objectType, err)
		}
		if !strings.Contains(query, "ALL_TYPES") || !strings.Contains(query, "ALL_SCHEMAS") || !strings.Contains(query, column) || !strings.Contains(query, "TYPE_NAME") {
			t.Fatalf("unexpected %s source query:\n%s", objectType, query)
		}
		assertArgs(t, args, []any{"APP", "ADDRESS_T"})
	}
}

func TestXuguObjectSourceQuerySeparatesPackagePartsAndSupportsSequences(t *testing.T) {
	procedureSQL, procedureArgs, err := objectSourceQuery("APP", "SYNC_ORDERS", "PROCEDURE")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(procedureSQL, "ALL_PROCEDURES") || !strings.Contains(procedureSQL, "p.RET_TYPE IS NULL") || strings.Contains(procedureSQL, "SYS_PROCEDURES") {
		t.Fatalf("procedure source should use the accessible ALL_PROCEDURES definition: %s", procedureSQL)
	}
	assertArgs(t, procedureArgs, []any{"APP", "SYNC_ORDERS"})

	functionSQL, functionArgs, err := objectSourceQuery("APP", "SYNC_STATUS", "FUNCTION")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(functionSQL, "ALL_PROCEDURES") || !strings.Contains(functionSQL, "p.RET_TYPE IS NOT NULL") {
		t.Fatalf("function source should select only functions from ALL_PROCEDURES: %s", functionSQL)
	}
	assertArgs(t, functionArgs, []any{"APP", "SYNC_STATUS"})

	packageSQL, packageArgs, err := objectSourceQuery("APP", "PAYROLL", "PACKAGE")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(packageSQL, "TO_CHAR(k.SPEC)") || !strings.Contains(packageSQL, "ALL_PACKAGES") || !strings.Contains(packageSQL, "ALL_SCHEMAS") || strings.Contains(packageSQL, "TO_CHAR(k.BODY)") || strings.Contains(packageSQL, "SYS_PACKAGES") {
		t.Fatalf("package source should only return the specification: %s", packageSQL)
	}
	assertArgs(t, packageArgs, []any{"APP", "PAYROLL"})

	bodySQL, bodyArgs, err := objectSourceQuery("APP", "PAYROLL", "PACKAGE_BODY")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(bodySQL, "TO_CHAR(k.BODY)") || !strings.Contains(bodySQL, "ALL_PACKAGES") || strings.Contains(bodySQL, "TO_CHAR(k.SPEC)") || strings.Contains(bodySQL, "SYS_PACKAGES") {
		t.Fatalf("package body source should only return the body: %s", bodySQL)
	}
	assertArgs(t, bodyArgs, []any{"APP", "PAYROLL"})

	triggerSQL, triggerArgs, err := objectSourceQuery("APP", "TR_AUDIT", "TRIGGER")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(triggerSQL, "ALL_TRIGGERS") || !strings.Contains(triggerSQL, "ALL_SCHEMAS") || !strings.Contains(triggerSQL, "TO_CHAR(t.DEFINE)") || strings.Contains(triggerSQL, "SYS_TRIGGERS") {
		t.Fatalf("trigger source should use public dictionary views: %s", triggerSQL)
	}
	assertArgs(t, triggerArgs, []any{"APP", "TR_AUDIT"})

	sequenceSQL, sequenceArgs, err := objectSourceQuery("APP", "ORDER_SEQ", "SEQUENCE")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(sequenceSQL, "DBMS_METADATA.GET_DDL('SEQUENCE'") {
		t.Fatalf("sequence source should use DBMS_METADATA: %s", sequenceSQL)
	}
	assertArgs(t, sequenceArgs, []any{"ORDER_SEQ", "APP"})

	synonymSQL, synonymArgs, err := objectSourceQuery("APP", "CUSTOMERS", "SYNONYM")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(synonymSQL, "SYS_SYNONYMS") || !strings.Contains(synonymSQL, "TARG_SCHE_ID") {
		t.Fatalf("synonym source should resolve target schema from SYS_SYNONYMS: %s", synonymSQL)
	}
	assertArgs(t, synonymArgs, []any{"APP", "CUSTOMERS"})
}

func TestBuildSequenceDDLUsesXuguDictionaryValues(t *testing.T) {
	ddl := formatSequenceDDL("APP", "ORDER_SEQ", "10", "5", "1", "999", true)
	if ddl != `CREATE SEQUENCE "APP"."ORDER_SEQ" MINVALUE 1 MAXVALUE 999 START WITH 10 INCREMENT BY 5 CYCLE;` {
		t.Fatalf("unexpected sequence DDL: %s", ddl)
	}
}

func TestMetadataListConstraintsFromParams(t *testing.T) {
	params := map[string]json.RawMessage{
		"filter":       json.RawMessage(`"tab"`),
		"limit":        json.RawMessage(`30`),
		"offset":       json.RawMessage(`5`),
		"object_types": json.RawMessage(`["TABLE","VIEW"]`),
	}

	constraints := metadataListConstraintsFromParams(params)
	if constraints.Filter != "tab" || constraints.Limit != 30 || constraints.Offset != 5 {
		t.Fatalf("unexpected constraints: %+v", constraints)
	}
	if len(constraints.ObjectTypes) != 2 || constraints.ObjectTypes[0] != "TABLE" || constraints.ObjectTypes[1] != "VIEW" {
		t.Fatalf("unexpected object types: %+v", constraints.ObjectTypes)
	}
}

func assertArgs(t *testing.T, got []any, want []any) {
	t.Helper()
	if len(got) != len(want) {
		t.Fatalf("args length = %d, want %d: got=%#v want=%#v", len(got), len(want), got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("arg %d = %#v, want %#v; args=%#v", i, got[i], want[i], got)
		}
	}
}

func TestParseForeignKeyColumns(t *testing.T) {
	local, ref := parseForeignKeyColumns(`("C1","C2")("ID1","ID2")`)

	if strings.Join(local, ",") != "C1,C2" || strings.Join(ref, ",") != "ID1,ID2" {
		t.Fatalf("unexpected foreign key columns: local=%v ref=%v", local, ref)
	}
}

func TestDecodeXuguScale(t *testing.T) {
	numericScale := 32*65536 + 6
	precision, scale, length := decodeXuguScale("NUMERIC", &numericScale)
	if precision == nil || *precision != 32 || scale == nil || *scale != 6 || length != nil {
		t.Fatalf("unexpected numeric scale decode: precision=%v scale=%v length=%v", precision, scale, length)
	}

	charScale := 128
	precision, scale, length = decodeXuguScale("VARCHAR", &charScale)
	if precision != nil || scale != nil || length == nil || *length != 128 {
		t.Fatalf("unexpected char scale decode: precision=%v scale=%v length=%v", precision, scale, length)
	}
}

func TestNormalizeXuguColumnTypeUsesVaryingFlag(t *testing.T) {
	tests := []struct {
		name     string
		dataType string
		varying  any
		want     string
	}{
		{name: "varying char", dataType: "CHAR", varying: true, want: "VARCHAR"},
		{name: "fixed char", dataType: "CHAR", varying: false, want: "CHAR"},
		{name: "varying binary", dataType: "BINARY", varying: true, want: "VARBINARY"},
		{name: "fixed binary", dataType: "BINARY", varying: false, want: "BINARY"},
		{name: "other varying type", dataType: "NUMERIC", varying: true, want: "NUMERIC"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := normalizeXuguColumnType(tt.dataType, tt.varying); got != tt.want {
				t.Fatalf("normalizeXuguColumnType(%q, %v) = %q, want %q", tt.dataType, tt.varying, got, tt.want)
			}
		})
	}
}

func TestXuguDataTypesIncludeContentAndSpecialTypes(t *testing.T) {
	available := map[string]bool{}
	for _, dataType := range xuguDataTypes {
		available[dataType] = true
	}
	for _, want := range []string{"JSON", "XMLTYPE", "BFILE", "GUID", "ROWID", "VARBIT", "GEOMETRY", "INTERVAL DAY TO SECOND"} {
		if !available[want] {
			t.Fatalf("missing Xugu data type %q", want)
		}
	}
}

func TestNormalizeXuguBinaryValuesAsHex(t *testing.T) {
	if got := normalizeValue([]byte{0x00, 0xff, 0x7f}, "BLOB"); got != "0x00ff7f" {
		t.Fatalf("BLOB bytes = %#v, want hex", got)
	}
	if got := normalizeValue([]byte("virtual-valley"), "VARCHAR"); got != "virtual-valley" {
		t.Fatalf("VARCHAR bytes = %#v, want text", got)
	}
}

func TestAppendDDLStatement(t *testing.T) {
	got := appendDDLStatement("CREATE TABLE \"T\" (\"ID\" INT)\n", "CREATE INDEX \"IDX\" ON \"T\"(\"ID\");")
	want := "CREATE TABLE \"T\" (\"ID\" INT);\n\nCREATE INDEX \"IDX\" ON \"T\"(\"ID\");"

	if got != want {
		t.Fatalf("unexpected DDL append:\ngot:  %q\nwant: %q", got, want)
	}
}

func TestQuoteStringLiteralEscapesSingleQuotes(t *testing.T) {
	if got := quoteStringLiteral("owner's note"); got != "'owner''s note'" {
		t.Fatalf("unexpected quoted string: %s", got)
	}
}

func TestXuguTriggerMetadataValues(t *testing.T) {
	if got := triggerTypeName(1); got != "FOR EACH ROW" {
		t.Fatalf("trigger type 1 = %q, want FOR EACH ROW", got)
	}
	if got := triggerTypeName("2"); got != "FOR STATEMENT" {
		t.Fatalf("trigger type 2 = %q, want FOR STATEMENT", got)
	}
	if got := xuguBoolPtr("TRUE"); got == nil || !*got {
		t.Fatalf("TRUE should decode as enabled")
	}
	if got := xuguBoolPtr("F"); got == nil || *got {
		t.Fatalf("F should decode as disabled")
	}
	if got := xuguBoolPtr("unknown"); got != nil {
		t.Fatalf("unknown boolean should remain unset, got %v", *got)
	}
}

func TestNormalizeValuePreservesDriverNumericTypes(t *testing.T) {
	if value := normalizeValue(int32(7)); value != int64(7) {
		t.Fatalf("expected int32 to normalize to int64, got %#v", value)
	}
	if value := normalizeValue(float32(1.25)); value != float64(float32(1.25)) {
		t.Fatalf("expected float32 to normalize to float64, got %#v", value)
	}
}

func contains(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}
