'use client';

import type { ReactElement } from 'react';
import { AdminPanel } from '../../components/admin-panel';
import { browserAdminPort } from '../../lib/ports';

export function AdminPage(): ReactElement {
  return <AdminPanel post={browserAdminPort} />;
}
