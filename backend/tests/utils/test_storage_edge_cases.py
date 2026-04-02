"""
Additional tests for storage providers to achieve 100% coverage.
"""

import pytest
from unittest.mock import Mock, patch, MagicMock
from rest_framework.exceptions import ValidationError

from app.utils.storage import (
    MockStorageProvider,
    AzureBlobStorageProvider,
)


class TestStorageProviderValidation:
    """Test StorageProvider validation methods."""

    def test_validate_file_no_file_provided(self):
        """Raises ValidationError when no file provided."""
        provider = MockStorageProvider()

        with pytest.raises(ValidationError) as exc_info:
            provider._validate_file(None, 'image/png')

        assert 'No file provided' in str(exc_info.value.detail)

    def test_validate_file_invalid_type(self):
        """Raises ValidationError for invalid file type."""
        provider = MockStorageProvider()
        file_obj = Mock()
        file_obj.size = 1000

        with pytest.raises(ValidationError) as exc_info:
            provider._validate_file(file_obj, 'application/pdf')

        assert 'Invalid file type' in str(exc_info.value.detail)

    def test_validate_file_case_insensitive_type(self):
        """Validates file type case-insensitively."""
        provider = MockStorageProvider()
        file_obj = Mock()
        file_obj.size = 1000

        # Should not raise for uppercase
        provider._validate_file(file_obj, 'IMAGE/PNG')

    def test_validate_file_too_large(self):
        """Raises ValidationError for files exceeding size limit."""
        provider = MockStorageProvider()
        file_obj = Mock()
        file_obj.size = 500 * 1024  # 500KB, exceeds 400KB limit

        with pytest.raises(ValidationError) as exc_info:
            provider._validate_file(file_obj, 'image/png')

        assert 'File too large' in str(exc_info.value.detail)
        assert '400KB' in str(exc_info.value.detail)


class TestAzureBlobStorageProvider:
    """Test AzureBlobStorageProvider initialization and upload."""

    def test_init_without_account_url(self):
        """Raises ValueError when account_url not provided."""
        with pytest.raises(ValueError) as exc_info:
            AzureBlobStorageProvider(account_url='')

        assert 'account_url is required' in str(exc_info.value)

    def test_init_without_azure_sdk(self):
        """Raises ImportError when azure-storage-blob not installed."""
        # Mock the import to raise ImportError
        with patch.dict('sys.modules', {'azure.storage.blob': None}):
            with patch('builtins.__import__', side_effect=ImportError('No module named azure')):
                with pytest.raises(ImportError) as exc_info:
                    AzureBlobStorageProvider(account_url='https://test.blob.core.windows.net')

                assert 'azure-storage-blob is required' in str(exc_info.value)

    def test_upload_file_success(self):
        """Tests successful file upload to Azure Blob Storage."""
        # Create mock Azure SDK classes
        mock_content_settings_class = Mock()
        mock_blob_service_class = Mock()

        # Setup mock blob client
        mock_blob_client = Mock()
        mock_blob_client.url = 'https://test.blob.core.windows.net/media/abc123.png?sas=token'

        # Setup mock blob service
        mock_blob_service = Mock()
        mock_blob_service.get_blob_client.return_value = mock_blob_client
        mock_blob_service_class.return_value = mock_blob_service

        # Mock the azure.storage.blob module
        mock_azure_module = MagicMock()
        mock_azure_module.BlobServiceClient = mock_blob_service_class
        mock_azure_module.ContentSettings = mock_content_settings_class

        with patch.dict('sys.modules', {'azure.storage.blob': mock_azure_module}):
            provider = AzureBlobStorageProvider(account_url='https://test.blob.core.windows.net')

            # Create mock file
            file_obj = Mock()
            file_obj.read.return_value = b'fake image data'
            file_obj.size = 1000

            # Upload file
            result = provider._upload_file_impl(file_obj, 'abc123.png', 'image/png')

            assert result['success'] is True
            assert '?sas=' not in result['url']  # SAS token removed
            assert 'abc123.png' in result['url']
            assert result['error'] is None

    def test_upload_file_failure(self):
        """Tests upload failure handling."""
        # Create mock Azure SDK classes
        mock_content_settings_class = Mock()
        mock_blob_service_class = Mock()

        # Setup mock blob client to raise exception
        mock_blob_client = Mock()
        mock_blob_client.upload_blob.side_effect = Exception('Azure error')

        # Setup mock blob service
        mock_blob_service = Mock()
        mock_blob_service.get_blob_client.return_value = mock_blob_client
        mock_blob_service_class.return_value = mock_blob_service

        # Mock the azure.storage.blob module
        mock_azure_module = MagicMock()
        mock_azure_module.BlobServiceClient = mock_blob_service_class
        mock_azure_module.ContentSettings = mock_content_settings_class

        with patch.dict('sys.modules', {'azure.storage.blob': mock_azure_module}):
            provider = AzureBlobStorageProvider(account_url='https://test.blob.core.windows.net')

            # Create mock file
            file_obj = Mock()
            file_obj.read.return_value = b'fake image data'
            file_obj.size = 1000

            # Upload file (should handle exception)
            result = provider._upload_file_impl(file_obj, 'abc123.png', 'image/png')

            assert result['success'] is False
            assert result['url'] is None
            assert 'Azure Blob Storage upload failed' in result['error']
            assert 'Azure error' in result['error']


class TestEnsureContainerExists:
    """Test _ensure_container_exists auto-creates missing containers."""

    def _make_azure_module(self):
        """Create mock azure.storage.blob module."""
        mock_azure_module = MagicMock()
        mock_blob_service_class = Mock()
        mock_content_settings_class = Mock()
        mock_azure_module.BlobServiceClient = mock_blob_service_class
        mock_azure_module.ContentSettings = mock_content_settings_class
        return mock_azure_module, mock_blob_service_class

    def test_container_exists_no_creation(self):
        """Does not create container when it already exists."""
        mock_azure_module, mock_blob_service_class = self._make_azure_module()
        mock_blob_service = Mock()
        mock_blob_service_class.return_value = mock_blob_service

        # get_container_properties succeeds → container exists
        mock_container_client = Mock()
        mock_blob_service.get_container_client.return_value = mock_container_client

        with patch.dict('sys.modules', {'azure.storage.blob': mock_azure_module}):
            AzureBlobStorageProvider(account_url='https://test.blob.core.windows.net')

        mock_blob_service.get_container_client.assert_called_once_with('media')
        mock_container_client.get_container_properties.assert_called_once()
        mock_blob_service.create_container.assert_not_called()

    def test_container_missing_creates_it(self):
        """Creates container when get_container_properties raises."""
        mock_azure_module, mock_blob_service_class = self._make_azure_module()
        mock_blob_service = Mock()
        mock_blob_service_class.return_value = mock_blob_service

        # get_container_properties fails → container doesn't exist
        mock_container_client = Mock()
        mock_container_client.get_container_properties.side_effect = Exception('ContainerNotFound')
        mock_blob_service.get_container_client.return_value = mock_container_client

        with patch.dict('sys.modules', {'azure.storage.blob': mock_azure_module}):
            AzureBlobStorageProvider(account_url='https://test.blob.core.windows.net')

        mock_blob_service.create_container.assert_called_once_with('media')

    def test_container_creation_failure_logs_warning(self):
        """Logs warning when container creation fails (e.g. permission denied)."""
        mock_azure_module, mock_blob_service_class = self._make_azure_module()
        mock_blob_service = Mock()
        mock_blob_service_class.return_value = mock_blob_service

        # Container doesn't exist and creation also fails
        mock_container_client = Mock()
        mock_container_client.get_container_properties.side_effect = Exception('ContainerNotFound')
        mock_blob_service.get_container_client.return_value = mock_container_client
        mock_blob_service.create_container.side_effect = Exception('AuthorizationFailure')

        with patch.dict('sys.modules', {'azure.storage.blob': mock_azure_module}):
            with patch('app.utils.storage.logger') as mock_logger:
                # Should not raise — logs warning instead
                AzureBlobStorageProvider(account_url='https://test.blob.core.windows.net')

                mock_logger.warning.assert_called_once()
                assert 'media' in mock_logger.warning.call_args[0][0]

    def test_custom_container_name(self):
        """Uses custom container name when provided."""
        mock_azure_module, mock_blob_service_class = self._make_azure_module()
        mock_blob_service = Mock()
        mock_blob_service_class.return_value = mock_blob_service

        mock_container_client = Mock()
        mock_container_client.get_container_properties.side_effect = Exception('ContainerNotFound')
        mock_blob_service.get_container_client.return_value = mock_container_client

        with patch.dict('sys.modules', {'azure.storage.blob': mock_azure_module}):
            AzureBlobStorageProvider(
                account_url='https://test.blob.core.windows.net',
                container='custom-bucket',
            )

        mock_blob_service.get_container_client.assert_called_once_with('custom-bucket')
        mock_blob_service.create_container.assert_called_once_with('custom-bucket')
