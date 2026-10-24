"""Server-only Earth Engine credentials; never import into frontend code."""
import json
import os

import ee
from google.oauth2 import service_account


def initialize_earth_engine(project):
    raw = os.environ.get('EE_SERVICE_ACCOUNT_JSON')
    if raw:
        try:
            info = json.loads(raw)
            if info.get('type') != 'service_account':
                raise ValueError('Wrong credential type')
            credentials = service_account.Credentials.from_service_account_info(
                info, scopes=['https://www.googleapis.com/auth/cloud-platform']
            )
        except (ValueError, TypeError, KeyError):
            raise RuntimeError('Invalid server-side EE_SERVICE_ACCOUNT_JSON configuration.') from None
        ee.Initialize(credentials=credentials, project=project)
    elif os.environ.get('VERCEL'):
        raise RuntimeError('Configure EE_SERVICE_ACCOUNT_JSON in Vercel server environment settings.')
    else:
        ee.Initialize(project=project)
