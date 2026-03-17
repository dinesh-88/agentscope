use axum::response::{Html, IntoResponse};
use serde_json::{json, Value};

pub async fn openapi_json() -> impl IntoResponse {
    axum::Json(spec())
}

pub async fn swagger_ui() -> impl IntoResponse {
    Html(
        r#"<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>AgentScope API Docs</title>
    <link
      rel="stylesheet"
      href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css"
    />
    <style>
      body { margin: 0; background: #fafafa; }
      #swagger-ui { max-width: 1200px; margin: 0 auto; }
    </style>
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
    <script>
      window.ui = SwaggerUIBundle({
        url: '/openapi.json',
        dom_id: '#swagger-ui',
        deepLinking: true,
        presets: [SwaggerUIBundle.presets.apis],
      });
    </script>
  </body>
</html>"#,
    )
}

fn spec() -> Value {
    json!({
      "openapi": "3.0.3",
      "info": {
        "title": "AgentScope API",
        "version": "0.1.0",
        "description": "API for AgentScope run ingestion, analysis, and debugging workflows."
      },
      "servers": [
        { "url": "http://localhost:8080", "description": "Local API server" }
      ],
      "components": {
        "securitySchemes": {
          "bearerAuth": {
            "type": "http",
            "scheme": "bearer",
            "bearerFormat": "JWT"
          },
          "apiKeyAuth": {
            "type": "apiKey",
            "in": "header",
            "name": "X-AgentScope-API-Key"
          }
        },
        "schemas": {
          "Run": {
            "type": "object",
            "properties": {
              "id": { "type": "string" },
              "project_id": { "type": "string" },
              "organization_id": { "type": ["string", "null"] },
              "workflow_name": { "type": "string" },
              "agent_name": { "type": "string" },
              "status": { "type": "string" },
              "started_at": { "type": "string", "format": "date-time" },
              "ended_at": { "type": ["string", "null"], "format": "date-time" },
              "total_input_tokens": { "type": "integer" },
              "total_output_tokens": { "type": "integer" },
              "total_tokens": { "type": "integer" },
              "total_cost_usd": { "type": "number" }
            }
          },
          "Span": {
            "type": "object",
            "properties": {
              "id": { "type": "string" },
              "run_id": { "type": "string" },
              "parent_span_id": { "type": ["string", "null"] },
              "span_type": { "type": "string" },
              "name": { "type": "string" },
              "status": { "type": "string" },
              "started_at": { "type": "string", "format": "date-time" },
              "ended_at": { "type": ["string", "null"], "format": "date-time" },
              "provider": { "type": ["string", "null"] },
              "model": { "type": ["string", "null"] },
              "input_tokens": { "type": ["integer", "null"] },
              "output_tokens": { "type": ["integer", "null"] },
              "total_tokens": { "type": ["integer", "null"] },
              "estimated_cost": { "type": ["number", "null"] },
              "context_window": { "type": ["integer", "null"] },
              "context_usage_percent": { "type": ["number", "null"] },
              "metadata": {}
            }
          },
          "Artifact": {
            "type": "object",
            "properties": {
              "id": { "type": "string" },
              "run_id": { "type": "string" },
              "span_id": { "type": ["string", "null"] },
              "kind": { "type": "string" },
              "payload": {}
            }
          },
          "IngestPayload": {
            "type": "object",
            "properties": {
              "run": { "$ref": "#/components/schemas/Run" },
              "spans": {
                "type": "array",
                "items": { "$ref": "#/components/schemas/Span" }
              },
              "artifacts": {
                "type": "array",
                "items": { "$ref": "#/components/schemas/Artifact" }
              }
            },
            "required": ["run", "spans", "artifacts"]
          },
          "RunMetrics": {
            "type": "object",
            "properties": {
              "run_id": { "type": "string" },
              "input_tokens": { "type": "integer" },
              "output_tokens": { "type": "integer" },
              "total_tokens": { "type": "integer" },
              "estimated_cost": { "type": "number" }
            }
          },
          "ProjectApiKeyResponse": {
            "type": "object",
            "properties": {
              "api_key": { "type": "string" }
            }
          },
          "LoginRequest": {
            "type": "object",
            "properties": {
              "email": { "type": "string" },
              "password": { "type": "string" }
            }
          },
          "RegisterRequest": {
            "type": "object",
            "properties": {
              "email": { "type": "string" },
              "password": { "type": "string" },
              "display_name": { "type": ["string", "null"] },
              "organization_name": { "type": "string" },
              "project_name": { "type": ["string", "null"] }
            }
          }
        }
      },
      "paths": {
        "/v1/auth/login": {
          "post": {
            "summary": "Login with email/password",
            "requestBody": {
              "required": true,
              "content": {
                "application/json": {
                  "schema": { "$ref": "#/components/schemas/LoginRequest" }
                }
              }
            },
            "responses": {
              "200": { "description": "Authenticated user token" }
            }
          }
        },
        "/v1/auth/register": {
          "post": {
            "summary": "Register a user, org, project, and default API key",
            "requestBody": {
              "required": true,
              "content": {
                "application/json": {
                  "schema": { "$ref": "#/components/schemas/RegisterRequest" }
                }
              }
            },
            "responses": {
              "200": { "description": "Registered account and bootstrap API key" }
            }
          }
        },
        "/v1/ingest": {
          "post": {
            "summary": "Ingest run telemetry",
            "security": [{ "apiKeyAuth": [] }],
            "requestBody": {
              "required": true,
              "content": {
                "application/json": {
                  "schema": { "$ref": "#/components/schemas/IngestPayload" }
                }
              }
            },
            "responses": {
              "200": { "description": "Accepted" },
              "401": { "description": "Missing or invalid API key" }
            }
          }
        },
        "/v1/runs": {
          "get": {
            "summary": "List accessible runs",
            "security": [{ "bearerAuth": [] }],
            "responses": {
              "200": {
                "description": "Runs",
                "content": {
                  "application/json": {
                    "schema": {
                      "type": "array",
                      "items": { "$ref": "#/components/schemas/Run" }
                    }
                  }
                }
              }
            }
          }
        },
        "/v1/runs/{id}": {
          "get": {
            "summary": "Get run detail",
            "security": [{ "bearerAuth": [] }],
            "parameters": [{ "name": "id", "in": "path", "required": true, "schema": { "type": "string" } }],
            "responses": { "200": { "description": "Run" } }
          }
        },
        "/v1/runs/{id}/spans": {
          "get": {
            "summary": "Get run spans",
            "security": [{ "bearerAuth": [] }],
            "parameters": [{ "name": "id", "in": "path", "required": true, "schema": { "type": "string" } }],
            "responses": { "200": { "description": "Spans" } }
          }
        },
        "/v1/runs/{id}/artifacts": {
          "get": {
            "summary": "Get run artifacts",
            "security": [{ "bearerAuth": [] }],
            "parameters": [{ "name": "id", "in": "path", "required": true, "schema": { "type": "string" } }],
            "responses": { "200": { "description": "Artifacts" } }
          }
        },
        "/v1/runs/{id}/analysis": {
          "get": {
            "summary": "Get or compute run analysis",
            "security": [{ "bearerAuth": [] }],
            "parameters": [{ "name": "id", "in": "path", "required": true, "schema": { "type": "string" } }],
            "responses": { "200": { "description": "Analysis" } }
          }
        },
        "/v1/runs/{id}/insights": {
          "get": {
            "summary": "Get run insights",
            "security": [{ "bearerAuth": [] }],
            "parameters": [{ "name": "id", "in": "path", "required": true, "schema": { "type": "string" } }],
            "responses": { "200": { "description": "Insights" } }
          }
        },
        "/v1/runs/{id}/root-cause": {
          "get": {
            "summary": "Get root cause record",
            "security": [{ "bearerAuth": [] }],
            "parameters": [{ "name": "id", "in": "path", "required": true, "schema": { "type": "string" } }],
            "responses": { "200": { "description": "Root cause" } }
          }
        },
        "/v1/runs/{id}/metrics": {
          "get": {
            "summary": "Get run token and cost metrics",
            "security": [{ "bearerAuth": [] }],
            "parameters": [{ "name": "id", "in": "path", "required": true, "schema": { "type": "string" } }],
            "responses": {
              "200": {
                "description": "Metrics",
                "content": {
                  "application/json": {
                    "schema": { "$ref": "#/components/schemas/RunMetrics" }
                  }
                }
              }
            }
          }
        },
        "/v1/runs/{id}/compare/{other_id}": {
          "get": {
            "summary": "Compare two runs",
            "security": [{ "bearerAuth": [] }],
            "parameters": [
              { "name": "id", "in": "path", "required": true, "schema": { "type": "string" } },
              { "name": "other_id", "in": "path", "required": true, "schema": { "type": "string" } }
            ],
            "responses": { "200": { "description": "Run comparison diff" } }
          }
        },
        "/v1/projects/{id}/api-keys": {
          "post": {
            "summary": "Create a project API key",
            "security": [{ "bearerAuth": [] }],
            "parameters": [{ "name": "id", "in": "path", "required": true, "schema": { "type": "string" } }],
            "responses": {
              "200": {
                "description": "Created API key",
                "content": {
                  "application/json": {
                    "schema": { "$ref": "#/components/schemas/ProjectApiKeyResponse" }
                  }
                }
              }
            }
          }
        }
      }
    })
}
