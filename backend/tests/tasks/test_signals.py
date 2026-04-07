from unittest.mock import MagicMock, patch

from app.celery import _on_task_failure


class TestTaskFailureSignal:
    @patch('app.celery.logger')
    def test_logs_error_on_task_failure(self, mock_logger):
        sender = MagicMock()
        sender.name = 'app.celery.send_message'
        exc = ValueError('something broke')

        _on_task_failure(
            sender=sender,
            task_id='abc-123',
            exception=exc,
            traceback=None,
        )

        mock_logger.error.assert_called_once()
        call_args = mock_logger.error.call_args
        msg = call_args[0][0] % call_args[0][1:]
        assert 'send_message' in msg
        assert 'abc-123' in msg
        assert 'something broke' in msg

    @patch('app.celery.logger')
    def test_handles_missing_sender(self, mock_logger):
        exc = RuntimeError('fail')

        _on_task_failure(
            sender=None,
            task_id='xyz-456',
            exception=exc,
            traceback=None,
        )

        mock_logger.error.assert_called_once()
        call_args = mock_logger.error.call_args
        msg = call_args[0][0] % call_args[0][1:]
        assert 'unknown' in msg
