import logging
import uuid
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Optional, cast

from django.conf import settings
from rest_framework.exceptions import ValidationError


logger = logging.getLogger(__name__)


class StorageProvider(ABC):
    """Abstract base class for media storage providers.

    Handles file validation and filename generation in the base class, so concrete
    implementations only need to focus on the actual storage logic.

    All public methods handle validation automatically before calling the abstract
    implementation methods.
    """

    ALLOWED_TYPES = {'image/png', 'image/jpeg', 'image/jpg', 'image/gif'}
    MAX_FILE_SIZE = 400 * 1024  # 400KB

    def _validate_file(self, file_obj, content_type: str) -> None:
        """Validate file before storage. Raises ValidationError on failure."""
        if not file_obj:
            raise ValidationError('No file provided.')

        if content_type.lower() not in self.ALLOWED_TYPES:
            allowed = ', '.join(sorted(self.ALLOWED_TYPES))
            raise ValidationError(f'Invalid file type. Allowed: {allowed}')

        if file_obj.size > self.MAX_FILE_SIZE:
            max_kb = self.MAX_FILE_SIZE // 1024
            raise ValidationError(f'File too large. Maximum size: {max_kb}KB')

    def _generate_unique_filename(self, original_filename: str) -> str:
        """Generate UUID-based filename preserving extension."""
        ext = Path(original_filename).suffix.lower()  # e.g., '.png'
        unique_id = uuid.uuid4().hex[:16]
        return f"{unique_id}{ext}"

    def upload_file(self, file_obj, filename: str, content_type: str) -> dict:
        """Upload a file to storage.

        Validates the file, generates a unique filename, then calls _upload_file_impl().

        Args:
            file_obj: Django UploadedFile object
            filename: Original filename from upload
            content_type: MIME type of the file

        Returns:
            dict with keys: success (bool), url (str), file_id (str), error (str),
            size (int), content_type (str)
        """
        # Validate file
        self._validate_file(file_obj, content_type)

        # Generate unique filename
        unique_filename = self._generate_unique_filename(filename)

        # Call implementation
        result = self._upload_file_impl(file_obj, unique_filename, content_type)
        result['file_id'] = unique_filename
        result['size'] = file_obj.size
        result['content_type'] = content_type
        return result

    @abstractmethod
    def _upload_file_impl(self, file_obj, unique_filename: str, content_type: str) -> dict:
        """Implementation method for uploading files.

        File is already validated and filename is unique.

        Args:
            file_obj: Django UploadedFile object
            unique_filename: Unique filename (UUID-based with extension)
            content_type: MIME type

        Returns:
            dict with keys: success (bool), url (str), error (str)
        """
        pass


class MockStorageProvider(StorageProvider):
    """Mock storage provider for development and testing.

    Logs all operations but doesn't actually store files.
    Always returns success with generated URLs.
    """

    def _upload_file_impl(self, file_obj, unique_filename: str, content_type: str) -> dict:
        """Log upload and return mock URL."""
        mock_url = f'https://mock-storage.example.com/media/{unique_filename}'

        logger.info(
            'MockStorageProvider.upload_file',
            extra={
                'filename': unique_filename,
                'content_type': content_type,
                'size': file_obj.size,
                'url': mock_url,
            },
        )

        return {
            'success': True,
            'url': mock_url,
            'error': None,
        }


class AzureBlobStorageProvider(StorageProvider):
    """Azure Blob Storage provider.

    Uses azure-storage-blob SDK to upload files to Azure Blob Storage.
    Requires account_url (with SAS token) and container name.
    """

    def __init__(self, account_url: str = '', container: str = 'media'):
        """Initialize Azure Blob Storage provider.

        Args:
            account_url: Azure Blob Storage account URL with SAS token
            container: Container name (default: 'media')

        Raises:
            ValueError: If account_url is not provided
        """
        if not account_url:
            raise ValueError(
                'Azure Blob Storage account_url is required. '
                'Set AZURE_BLOB_URL environment variable.'
            )

        try:
            from azure.storage.blob import BlobServiceClient, ContentSettings
            self.BlobServiceClient = BlobServiceClient
            self.ContentSettings = ContentSettings
        except ImportError:
            raise ImportError(
                'azure-storage-blob is required for AzureBlobStorageProvider. '
                'Install it with: pip install azure-storage-blob'
            )

        self.blob_service_client = self.BlobServiceClient(account_url=account_url)
        self.container = container

        logger.info(
            f'AzureBlobStorageProvider initialized with container: {container}'
        )

    def _upload_file_impl(self, file_obj, unique_filename: str, content_type: str) -> dict:
        """Upload file to Azure Blob Storage."""
        try:
            # Get blob client for this file
            blob_client = self.blob_service_client.get_blob_client(
                container=self.container,
                blob=unique_filename
            )

            # Upload with content-type header
            blob_client.upload_blob(
                file_obj.read(),
                content_settings=self.ContentSettings(content_type=content_type),
                overwrite=False  # Prevent accidental overwrites
            )

            # Return clean URL (remove SAS token query params)
            url = blob_client.url.split('?')[0]

            logger.info(
                'AzureBlobStorageProvider.upload_file',
                extra={
                    'filename': unique_filename,
                    'content_type': content_type,
                    'size': file_obj.size,
                    'url': url,
                },
            )

            return {
                'success': True,
                'url': url,
                'error': None,
            }

        except Exception as e:
            error_msg = f'Azure Blob Storage upload failed: {str(e)}'
            logger.error(
                'AzureBlobStorageProvider.upload_file failed',
                extra={
                    'filename': unique_filename,
                    'error': error_msg,
                },
                exc_info=True,
            )

            return {
                'success': False,
                'url': None,
                'error': error_msg,
            }


class _StorageCache:
    """Simple cache for the storage provider singleton."""
    instance: Optional[StorageProvider] = None


def get_storage_provider() -> StorageProvider:
    """Get the configured storage provider instance (singleton).

    Provider class is determined by settings.STORAGE_PROVIDER_CLASS.
    Configuration is passed from settings.STORAGE_PROVIDER_CONFIG.
    Instance is cached in _StorageCache.
    """
    if _StorageCache.instance is None:
        provider_path = getattr(
            settings,
            'STORAGE_PROVIDER_CLASS',
            'app.utils.storage.MockStorageProvider'
        )

        # Import the provider class
        module_path, class_name = provider_path.rsplit('.', 1)
        module = __import__(module_path, fromlist=[class_name])
        provider_class = getattr(module, class_name)

        # Get provider configuration
        config = getattr(settings, 'STORAGE_PROVIDER_CONFIG', {})

        # Instantiate with config
        _StorageCache.instance = provider_class(**config)
        logger.info(f'Initialised storage provider: {provider_path}')

    return cast(StorageProvider, _StorageCache.instance)
