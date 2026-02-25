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
