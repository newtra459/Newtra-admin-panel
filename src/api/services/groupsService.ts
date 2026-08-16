import type { GroupRow } from '../../types/models';
import { httpRequest } from '../httpClient';
import { GROUPS_PATCH } from '../patches/groupsPatch';

export async function deleteGroup(id: string): Promise<void> {
  if (!id) {
    throw new Error('Cannot delete group: missing id');
  }
  try {
    await httpRequest({ method: 'DELETE', path: GROUPS_PATCH.endpoints.remove(id) });
  } catch (error: unknown) {
    const status = (error as { status?: number })?.status;
    if (status === 404 || status === 405) {
      throw new Error('Group deletion is not enabled on the backend for admin keys yet.');
    }
    throw error;
  }
}

export async function listGroups(query: Record<string, string> = {}): Promise<GroupRow[]> {
  const payload = await httpRequest({ method: 'GET', path: GROUPS_PATCH.endpoints.list, query });
  return GROUPS_PATCH.fromListPayload(payload);
}

export async function getGroupMembers(groupId: string): Promise<unknown[]> {
  const payload = await httpRequest({ method: 'GET', path: GROUPS_PATCH.endpoints.members(groupId) });
  return ((payload as Record<string, unknown>)?.data || []) as unknown[];
}

export async function getGroupMembersData(groupId: string): Promise<unknown[]> {
  const payload = await httpRequest({ method: 'GET', path: GROUPS_PATCH.endpoints.membersData(groupId) });
  return ((payload as Record<string, unknown>)?.data || []) as unknown[];
}
