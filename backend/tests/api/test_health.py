import pytest
from unittest.mock import patch
from django.test import override_settings
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
            mock_conn.ensure_connection.side_effect = Exception('DB unavailable')
            response = self.client.get('/api/health/')
        assert response.status_code == 503
        assert response.data['status'] == 'degraded'
        assert response.data['checks']['db'] != 'ok'
        assert response.data['checks']['redis'] == 'ok'

    def test_returns_503_when_redis_fails(self):
        with patch('app.health.redis') as mock_redis:
            mock_redis.from_url.return_value.ping.side_effect = Exception('Redis unavailable')
            response = self.client.get('/api/health/')
        assert response.status_code == 503
        assert response.data['status'] == 'degraded'
        assert response.data['checks']['redis'] != 'ok'
        assert response.data['checks']['db'] == 'ok'

    def test_returns_503_when_both_fail(self):
        with patch('app.health.connection') as mock_conn, \
             patch('app.health.redis') as mock_redis:
            mock_conn.ensure_connection.side_effect = Exception('DB down')
            mock_redis.from_url.return_value.ping.side_effect = Exception('Redis down')
            response = self.client.get('/api/health/')
        assert response.status_code == 503
        assert response.data['status'] == 'degraded'
        assert response.data['checks']['db'] != 'ok'
        assert response.data['checks']['redis'] != 'ok'


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
