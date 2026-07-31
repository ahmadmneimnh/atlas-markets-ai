"""Smoke tests for the scaffold.

They assert the *refusals*, which are the actual behaviour Phase 1 ships. When
Phase 4 registers real factor models these tests will fail — deliberately. A
scaffold test that keeps passing after the thing it describes has been replaced
is a test that was never checking anything.
"""

from fastapi.testclient import TestClient

from app.main import create_app

client = TestClient(create_app())


def test_health_is_live() -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_ready_reports_not_ready_without_factor_models() -> None:
    response = client.get("/ready")
    assert response.status_code == 503
    assert response.json()["status"] == "not_ready"


def test_score_refuses_rather_than_inventing_a_number() -> None:
    response = client.post(
        "/v1/score",
        json={
            "contractVersion": "1.0.0",
            "asset": {"kind": "crypto", "symbol": "BTC"},
            "inputs": {},
            "asOf": "2026-01-01T00:00:00Z",
        },
    )
    assert response.status_code == 501
    assert response.json()["detail"]["error"] == "engine_not_implemented"


def test_major_contract_mismatch_is_rejected() -> None:
    response = client.post(
        "/v1/score",
        json={
            "contractVersion": "2.0.0",
            "asset": {"kind": "crypto", "symbol": "BTC"},
            "inputs": {},
            "asOf": "2026-01-01T00:00:00Z",
        },
    )
    assert response.status_code == 409


def test_unknown_fields_are_rejected() -> None:
    response = client.post(
        "/v1/score",
        json={
            "contractVersion": "1.0.0",
            "asset": {"kind": "crypto", "symbol": "BTC"},
            "inputs": {},
            "asOf": "2026-01-01T00:00:00Z",
            "prise": 42,
        },
    )
    assert response.status_code == 422


def test_blank_api_key_is_treated_as_unset(monkeypatch: object) -> None:
    """`.env.example` ships `AI_ENGINE_API_KEY=`; that must not configure a secret."""
    from app.core.config import Settings

    assert Settings(AI_ENGINE_API_KEY="").api_key is None
    assert Settings(AI_ENGINE_API_KEY="   ").api_key is None
    assert Settings(AI_ENGINE_API_KEY="s3cret").api_key == "s3cret"


def test_configured_api_key_is_enforced() -> None:
    """With a key set, a request without it — or with the wrong one — is rejected."""
    from app.core.config import Settings, get_settings
    from app.main import create_app

    app = create_app()
    app.dependency_overrides[get_settings] = lambda: Settings(AI_ENGINE_API_KEY="s3cret")
    guarded = TestClient(app)

    body = {
        "contractVersion": "1.0.0",
        "asset": {"kind": "crypto", "symbol": "BTC"},
        "inputs": {},
        "asOf": "2026-01-01T00:00:00Z",
    }

    assert guarded.post("/v1/score", json=body).status_code == 401
    assert guarded.post("/v1/score", json=body, headers={"X-Atlas-Key": "wrong"}).status_code == 401
    assert guarded.post("/v1/score", json=body, headers={"X-Atlas-Key": "s3cret"}).status_code == 501
