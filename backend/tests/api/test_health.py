import pytest
from unittest.mock import patch
from django.db import DatabaseError
from django.test import override_settings
from redis import RedisError
from rest_framework.test import APIClient


@pytest.mark.django_db
class TestHealthCheck:
    def setup_method(self):
        self.client = APIClient()

    def test_returns_200_when_healthy(self):
        response = self.client.get('/api/health/')
        assert response.status_code == 200
        assert response.data['status'] == 'ok'
        assert response.data['checks']['db'] == 'ok'
        assert response.data['checks']['redis'] == 'ok'

    def test_no_auth_required(self):
        """Unauthenticated request succeeds — endpoint uses AllowAny."""
        response = self.client.get('/api/health/')
        assert response.status_code == 200

    def test_returns_503_when_db_fails(self):
        with patch('app.health.connection') as mock_conn:
            mock_conn.ensure_connection.side_effect = DatabaseError('DB unavailable')
            response = self.client.get('/api/health/')
        assert response.status_code == 503
        assert response.data['status'] == 'degraded'
        assert response.data['checks']['db'] != 'ok'
        assert response.data['checks']['redis'] == 'ok'

    def test_returns_503_when_redis_fails(self):
        with patch('app.health._get_redis_client') as mock_get:
            mock_get.return_value.ping.side_effect = RedisError('Redis unavailable')
            response = self.client.get('/api/health/')
        assert response.status_code == 503
        assert response.data['status'] == 'degraded'
        assert response.data['checks']['redis'] != 'ok'
        assert response.data['checks']['db'] == 'ok'

    def test_returns_503_when_both_fail(self):
        with patch('app.health.connection') as mock_conn, \
             patch('app.health._get_redis_client') as mock_get:
            mock_conn.ensure_connection.side_effect = DatabaseError('DB down')
            mock_get.return_value.ping.side_effect = RedisError('Redis down')
            response = self.client.get('/api/health/')
        assert response.status_code == 503
        assert response.data['status'] == 'degraded'
        assert response.data['checks']['db'] != 'ok'
        assert response.data['checks']['redis'] != 'ok'


@pytest.mark.django_db
class TestSmokeCheck:
    def setup_method(self):
        self.client = APIClient()

    def test_returns_200_when_healthy(self):
        response = self.client.get('/api/health/smoke/')
        assert response.status_code == 200
        assert response.data['status'] == 'ok'
        assert response.data['checks']['db_write'] == 'ok'
        assert response.data['checks']['redis_write'] == 'ok'

    def test_no_auth_required(self):
        response = self.client.get('/api/health/smoke/')
        assert response.status_code == 200

    def test_db_write_leaves_no_data(self):
        """Smoke test rolls back — no Config row persists."""
        from app.models import Config
        before = Config.objects.filter(name='_smoke_test').count()
        self.client.get('/api/health/smoke/')
        after = Config.objects.filter(name='_smoke_test').count()
        assert before == after

    def test_returns_503_when_db_write_fails(self):
        with patch('app.health.transaction') as mock_tx:
            mock_tx.atomic.side_effect = DatabaseError('DB write failed')
            mock_tx.set_rollback = lambda x: None
            response = self.client.get('/api/health/smoke/')
        assert response.status_code == 503
        assert response.data['status'] == 'degraded'
        assert response.data['checks']['db_write'] != 'ok'

    def test_returns_503_when_redis_write_fails(self):
        with patch('app.health._get_redis_client') as mock_get:
            mock_get.return_value.set.side_effect = RedisError('Redis write failed')
            response = self.client.get('/api/health/smoke/')
        assert response.status_code == 503
        assert response.data['status'] == 'degraded'
        assert response.data['checks']['redis_write'] != 'ok'
        assert response.data['checks']['db_write'] == 'ok'


class TestSwaggerGating:
    """Swagger/OpenAPI endpoints should only be accessible when DEBUG=True."""

    def setup_method(self):
        self.client = APIClient()

    @override_settings(DEBUG=False)
    def test_swagger_not_accessible_with_debug_false(self):
        response = self.client.get('/api/schema/')
        assert response.status_code == 404

    def test_swagger_urls_present_in_debug_urlconf(self):
        """Swagger URL patterns are defined in app.urls when DEBUG=True.

        URL patterns are evaluated at import time so we can't test the live
        endpoint with override_settings; instead we verify the conditional
        branch in the URL conf adds the expected named patterns.
        """
        import importlib
        from django.test import override_settings
        from django.urls import clear_url_caches

        with override_settings(DEBUG=True):
            import app.urls
            importlib.reload(app.urls)
            clear_url_caches()
            url_names = [p.name for p in app.urls.urlpatterns if hasattr(p, 'name')]
            importlib.reload(app.urls)  # restore to original DEBUG=False state
            clear_url_caches()

        assert 'schema' in url_names
        assert 'swagger-ui' in url_names
