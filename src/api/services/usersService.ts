import type { UserRow } from '../../types/models';
import { httpRequest } from '../httpClient';
import { USERS_PATCH } from '../patches/usersPatch';

export async function listUsers(query: Record<string, string> = {}): Promise<UserRow[]> {
  const payload = await httpRequest({ method: 'GET', path: USERS_PATCH.endpoints.list, query });
  return USERS_PATCH.fromListPayload(payload);
}

export async function getUser(uid: string): Promise<UserRow> {
  const payload = await httpRequest({ method: 'GET', path: USERS_PATCH.endpoints.get(uid) });
  const row = (payload as Record<string, unknown>)?.data || payload;
  return USERS_PATCH.fromApiUser(row as Parameters<typeof USERS_PATCH.fromApiUser>[0]);
}

export async function createUser(form: Record<string, unknown>, context: Record<string, unknown> = {}): Promise<unknown> {
  return httpRequest({ method: 'POST', path: USERS_PATCH.endpoints.create, body: USERS_PATCH.toCreatePayload(form, context) });
}

export async function updateUser(user: Record<string, unknown>): Promise<unknown> {
  const uid = String(user.apiId || user.id || '');
  return httpRequest({ method: 'PUT', path: USERS_PATCH.endpoints.update(uid), body: USERS_PATCH.toUpdatePayload(user) });
}

export async function deleteUser(userOrId: Record<string, unknown> | string): Promise<unknown> {
  const uid = typeof userOrId === 'string'
    ? userOrId
    : String(userOrId.apiId || userOrId.id || '');
  if (!uid) {
    throw new Error('Cannot delete user: missing uid');
  }

  let phone = typeof userOrId === 'string' ? '' : String(userOrId.phone || '').trim();
  if (!phone) {
    try {
      const remoteUser = await getUser(uid);
      phone = String(remoteUser.phone || '').trim();
    } catch {
      // Fallback to uid-only delete payload when user hydration fails.
    }
  }

  const payload = phone ? { uid, phone } : { uid };
  return httpRequest({ method: 'DELETE', path: USERS_PATCH.endpoints.remove, body: payload });
}

export async function setUserBlocked(user: Record<string, unknown>, blocked: boolean): Promise<unknown> {
  const uid = String(user.apiId || user.id || '');
  const path = blocked ? USERS_PATCH.endpoints.block(uid) : USERS_PATCH.endpoints.unblock(uid);
  return httpRequest({ method: 'POST', path });
}

export async function addUserCoins(user: Record<string, unknown>, amount: number): Promise<unknown> {
  const uid = String(user.apiId || user.id || '');
  return httpRequest({ method: 'POST', path: USERS_PATCH.endpoints.addCoins(uid), body: { amount } });
}

export async function addUserWalletBalance(user: Record<string, unknown>, amount: number): Promise<unknown> {
  const uid = String(user.apiId || user.id || '');
  return httpRequest({ method: 'POST', path: USERS_PATCH.endpoints.addWalletBalance(uid), body: { amount } });
}
