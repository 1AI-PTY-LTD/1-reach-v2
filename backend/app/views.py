import logging

from django.conf import settings
from rest_framework import generics
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from svix.webhooks import Webhook, WebhookVerificationError

from app.utils import clerk
from app.models import *
from app.serializers import *

logger = logging.getLogger(__name__)


class MeView(generics.RetrieveAPIView):
    serializer_class = MeSerializer
    permission_classes = [IsAuthenticated]

    def get_object(self):
        return self.request.user


class ClerkWebhookView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        signing_secret = settings.CLERK_WEBHOOK_SIGNING_SECRET
        if not signing_secret:
            logger.error('CLERK_WEBHOOK_SIGNING_SECRET not configured')
            return Response({'error': 'Webhook not configured'}, status=500)

        headers = {
            'svix-id': request.headers.get('svix-id', ''),
            'svix-timestamp': request.headers.get('svix-timestamp', ''),
            'svix-signature': request.headers.get('svix-signature', ''),
        }

        try:
            wh = Webhook(signing_secret)
            payload = wh.verify(request.body, headers)
        except WebhookVerificationError:
            logger.warning('Clerk webhook signature verification failed')
            return Response({'error': 'Invalid signature'}, status=400)

        event_type = payload.get('type')
        data = payload.get('data', {})

        handler = clerk.WEBHOOK_HANDLERS.get(event_type)
        if handler:
            handler(data)
            logger.info('Processed Clerk webhook event: %s', event_type)
        else:
            logger.debug('Unhandled Clerk webhook event: %s', event_type)

        return Response({'status': 'ok'})
