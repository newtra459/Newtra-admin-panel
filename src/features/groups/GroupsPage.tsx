import { useState, useMemo, useEffect } from 'react';
import Modal from '../../components/Modal';
import { useFilterPanel, FilterPanel } from '../../components/ColumnFilter';
import { loadSubscriptionPlans } from '../../config/subscription-plans';
import { SEED_GROUPS } from '../../utils/seedData';
import { isApiIntegrationEnabled } from '../../api/runtime';
import { listGroups, deleteGroup } from '../../api/services/groupsService';
import { listUsers } from '../../api/services/usersService';
import { listRides } from '../../api/services/ridesService';

const GROUPS_STORAGE_KEY = 'mos.groups.v1';

const HIDDEN_GROUPS_KEY = 'newtra:hidden-group-ids';
function loadHiddenGroupIds(): Set<string> {
  try { const r = localStorage.getItem(HIDDEN_GROUPS_KEY); return new Set(r ? JSON.parse(r) : []); } catch { return new Set(); }
}
function saveHiddenGroupId(id: string): void {
  try { const s = loadHiddenGroupIds(); s.add(id); localStorage.setItem(HIDDEN_GROUPS_KEY, JSON.stringify([...s])); } catch {}
}

const COLUMNS = [
  { key: 'id',      label: 'Group ID' },
  { key: 'name',    label: 'Name',         type: 'text' },
  { key: 'members', label: 'Members',      type: 'text' },
  { key: 'org',     label: 'Organization' },
  { key: 'status',  label: 'Status' },
];

function toKey(value) {
  return String(value || '').trim().toLowerCase();
}

function getMemberProfile(memberRef, groupName, usersByName, usersById) {
  const memberName = typeof memberRef === 'string' ? memberRef : String(memberRef?.name || memberRef?.id || '');
  const memberId = typeof memberRef === 'object' && memberRef ? String(memberRef.id || memberRef.userId || '') : '';
  const known = (memberId && usersById.get(memberId)) || usersByName.get(toKey(memberName));

  if (known) {
    return {
      ...known,
      name: known.name || memberName || 'Unknown Member',
      groups: Array.from(new Set([...(known.groups || []), groupName])),
    };
  }

  return {
    name: memberName || 'Unknown Member',
    id: memberId || '—',
    empId: '—',
    email: '—',
    role: '—',
    status: 'Inactive',
    joined: '—',
    businessType: '—',
    orgType: '—',
    orgName: '—',
    wallet: '₹0',
    coins: 0,
    rides: 0,
    activeRides: 0,
    completedRides: 0,
    cancelledRides: 0,
    subscriptions: [],
    groups: [groupName],
    location: '—',
    achievements: [],
  };
}

function getRideSummaryRows(user) {
  const total = user.rides || 0;
  const active = user.activeRides || 0;
  const completed = user.completedRides || 0;
  const cancelled = user.cancelledRides || 0;
  const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;

  return [
    { label: 'Total rides', value: total, hint: 'All trips recorded for this user' },
    { label: 'Active rides', value: active, hint: 'Trips currently in progress' },
    { label: 'Completed rides', value: completed, hint: 'Trips successfully finished' },
    { label: 'Cancelled rides', value: cancelled, hint: 'Trips ended before completion' },
    { label: 'Completion rate', value: `${completionRate}%`, hint: `${completed} of ${total} rides completed` },
  ];
}

function buildAllRideLogs(user, rides) {
  return rides
    .filter((ride) => ride.userId === user.id)
    .map((ride) => ({
      ...ride,
      date: ride.rideDate,
      route: `${ride.pickupLoc || ride.stationId || '—'} -> ${ride.dropoffLoc || '—'}`,
      vehicle: ride.vehicle || ride.bikeId || 'N/A',
    }));
}

function getMemberSubscriptions(member) {
  return (member.subscriptions || []).map((sub, index) => {
    if (typeof sub === 'string') {
      return {
        id: `sub-${index}`,
        name: sub,
        amount: 'Plan attached',
        startDate: member.joined || 'N/A',
        status: 'Active',
      };
    }

    return {
      id: sub.id || `sub-${index}`,
      name: sub.name || 'Unknown Plan',
      amount: sub.amount || 'Plan attached',
      startDate: sub.startDate || member.joined || 'N/A',
      status: sub.status || 'Active',
    };
  });
}

export default function GroupsPage() {
  const [groups,   setGroups]   = useState(() => {
    try {
      const raw = localStorage.getItem(GROUPS_STORAGE_KEY);
      if (raw) { const p = JSON.parse(raw); if (Array.isArray(p) && p.length) return p; }
    } catch {}
    return SEED_GROUPS;
  });
  const [selected, setSelected] = useState([]);
  const [showAdd,  setShowAdd]  = useState(false);
  const [detailGroup, setDetailGroup] = useState(null);
  const [detailMember, setDetailMember] = useState(null);
  const [apiUsers, setApiUsers] = useState([]);
  const [apiRides, setApiRides] = useState([]);
  const [memberTab, setMemberTab] = useState('overview');
  const [editSubForm, setEditSubForm] = useState(null);
  const [subscriptionPlans, setSubscriptionPlans] = useState(loadSubscriptionPlans);
  const [navPath, setNavPath] = useState([]);
  const [form,     setForm]     = useState({ name: '', org: '', type: 'Rider' });
  const fp = useFilterPanel();
  const statusClass = { Active: 'completed', Pending: 'pending', Inactive: 'cancelled', Blocked: 'cancelled' };
  const usersById = useMemo(() => {
    const map = new Map();
    apiUsers.forEach((user) => map.set(user.id, user));
    return map;
  }, [apiUsers]);
  const usersByName = useMemo(() => {
    const map = new Map();
    apiUsers.forEach((user) => map.set(toKey(user.name), user));
    return map;
  }, [apiUsers]);
  const allMemberRides = useMemo(() => (detailMember ? buildAllRideLogs(detailMember, apiRides) : []), [detailMember, apiRides]);
  const memberRideStats = useMemo(() => {
    const total = allMemberRides.length;
    const active = allMemberRides.filter((ride) => ride.status === 'Active').length;
    const cancelled = allMemberRides.filter((ride) => ride.status === 'Cancelled').length;
    const completed = Math.max(0, total - active - cancelled);
    const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;
    return { total, active, completed, cancelled, completionRate };
  }, [allMemberRides]);
  const memberSubscriptions = useMemo(() => (detailMember ? getMemberSubscriptions(detailMember) : []), [detailMember]);
  const activeSubscriptionPlans = useMemo(() => subscriptionPlans.filter((plan) => plan.status === 'Active' && (plan.type || 'Subscription') === 'Subscription'), [subscriptionPlans]);
  const activeTopupPlans = useMemo(() => subscriptionPlans.filter((plan) => plan.status === 'Active' && (plan.type || 'Subscription') === 'Topup'), [subscriptionPlans]);

  useEffect(() => {
    const handlePlansUpdated = () => setSubscriptionPlans(loadSubscriptionPlans());
    window.addEventListener('mos:subscription-plans-updated', handlePlansUpdated);
    return () => window.removeEventListener('mos:subscription-plans-updated', handlePlansUpdated);
  }, []);

  useEffect(() => {
    try { localStorage.setItem(GROUPS_STORAGE_KEY, JSON.stringify(groups)); } catch {}
  }, [groups]);

  useEffect(() => {
    if (!isApiIntegrationEnabled()) return;
    let mounted = true;
    listGroups()
      .then((rows) => {
        if (!mounted || !rows?.length) return;
        const hiddenIds = loadHiddenGroupIds();
        const hiddenUserIds = (() => {
          try { const raw = localStorage.getItem('newtra:hidden-user-ids'); return new Set<string>(raw ? JSON.parse(raw) : []); } catch { return new Set<string>(); }
        })();
        setGroups(rows.filter((r) => !hiddenIds.has(String(r.id || r.apiId || '')) && !hiddenUserIds.has(String(r.createdBy || ''))).map((r) => ({
          id: r.id || r.apiId,
          name: r.name,
          members: r.memberCount || 0,
          org: 'Global Pool',
          status: 'Active',
          type: r.category || 'Rider',
          founder: r.createdBy || 'Admin',
          created: r.createdAt ? new Date(r.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'N/A',
          description: r.description || 'No description.',
          ridesTotal: 0,
          ridesActive: 0,
          ridesCompleted: 0,
          ridesCancelled: 0,
          membersList: [],
          groupImage: r.groupImage || '',
          visibility: r.visibility || 'public',
        })));
      })
      .catch(() => {});
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (!isApiIntegrationEnabled()) {
      setApiUsers([]);
      setApiRides([]);
      return;
    }

    let mounted = true;
    Promise.all([
      listUsers({ page: 1, limit: 300 }).catch(() => []),
      listRides({ page: '1', limit: '1000' }).catch(() => []),
    ]).then(([usersRows, ridesRows]) => {
      if (!mounted) return;
      const hiddenUserIds = (() => {
        try { const raw = localStorage.getItem('newtra:hidden-user-ids'); return new Set<string>(raw ? JSON.parse(raw) : []); } catch { return new Set<string>(); }
      })();
      const activeUsers = Array.isArray(usersRows)
        ? usersRows.filter((u) => {
            const uid = String(u.id || u.apiId || '');
            const isBlocked = String(u.status || '').toLowerCase() === 'blocked' || String(u.status || '').toLowerCase() === 'inactive';
            return !hiddenUserIds.has(uid) && !isBlocked;
          })
        : [];
      setApiUsers(activeUsers);
      setApiRides(Array.isArray(ridesRows) ? ridesRows : []);
    });

    return () => { mounted = false; };
  }, []);

  const visible = useMemo(() =>
    groups.filter((g) => COLUMNS.every((c) => fp.match(c.key, c.key === 'members' ? String(g.members) : g[c.key]))),
    [groups, fp.filters]
  );

  const toggleAll = (c) => setSelected(c ? groups.map((r) => r.id) : []);
  const toggleRow = (id, c) => setSelected((p) => (c ? [...p, id] : p.filter((x) => x !== id)));

  const bulkDelete = async () => {
    if (!selected.length) return;
    if (!window.confirm(`Delete ${selected.length} selected group(s)?`)) return;
    for (const id of selected) {
      if (isApiIntegrationEnabled()) {
        try { await deleteGroup(id); } catch { /* hide locally if no backend endpoint */ }
      }
      saveHiddenGroupId(String(id));
    }
    setGroups((p) => p.filter((r) => !selected.includes(r.id)));
    setSelected([]);
  };
  const deleteRow = async (id) => {
    if (!window.confirm('Delete this group?')) return;
    if (isApiIntegrationEnabled()) {
      try {
        await deleteGroup(id);
      } catch {
        // Backend has no admin group delete endpoint — hide from view locally.
      }
    }
    saveHiddenGroupId(String(id));
    setGroups((p) => p.filter((r) => r.id !== id));
    setSelected((p) => p.filter((x) => x !== id));
  };

  const handleCreate = () => {
    if (!form.name.trim()) return;
    setGroups((p) => [
      ...p,
      {
        id: `GRP-${String(p.length + 1).padStart(3, '0')}`,
        name: form.name,
        members: 0,
        org: form.org || 'Global Pool',
        status: 'Active',
        type: form.type,
        founder: 'Admin User',
        created: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
        description: `${form.type} group created from admin panel.`,
        ridesTotal: 0,
        ridesActive: 0,
        ridesCompleted: 0,
        ridesCancelled: 0,
        membersList: [],
      },
    ]);
    setForm({ name: '', org: '', type: 'Rider' });
    setShowAdd(false);
  };

  const openGroupDetail = (group, append = false) => {
    if (!group) return;
    setDetailGroup(group);
    setDetailMember(null);
    setEditSubForm(null);
    setNavPath((p) => (append ? [...p, { type: 'group', id: group.id, name: group.name }] : [{ type: 'group', id: group.id, name: group.name }]));
  };

  const openMemberDetail = (memberName) => {
    if (!detailGroup) return;
    const member = getMemberProfile(memberName, detailGroup.name, usersByName, usersById);
    setDetailMember(member);
    setDetailGroup(null);
    setMemberTab('overview');
    setEditSubForm(null);
    setNavPath((p) => [...p, { type: 'member', id: member.id, name: member.name }]);
  };

  const openGroupFromMemberTab = (groupName) => {
    const target = groups.find((g) => g.name === groupName);
    if (!target) return;
    openGroupDetail(target, true);
  };

  const closeAllDetails = () => {
    setDetailGroup(null);
    setDetailMember(null);
    setEditSubForm(null);
    setNavPath([]);
  };

  const goBack = () => {
    if (navPath.length <= 1) {
      closeAllDetails();
      return;
    }

    const nextPath = navPath.slice(0, -1);
    const last = nextPath[nextPath.length - 1];
    setNavPath(nextPath);
    setEditSubForm(null);

    if (last.type === 'group') {
      const target = groups.find((g) => g.id === last.id);
      setDetailGroup(target || null);
      setDetailMember(null);
      return;
    }

    if (last.type === 'member') {
      const prevGroup = [...nextPath].reverse().find((item) => item.type === 'group');
      const member = getMemberProfile(last.name, prevGroup?.name || 'Global Pool', usersByName, usersById);
      setDetailMember(member);
      setDetailGroup(null);
    }
  };

  const jumpToPath = (pathIndex) => {
    if (pathIndex < 0 || pathIndex >= navPath.length) return;

    const nextPath = navPath.slice(0, pathIndex + 1);
    const target = nextPath[nextPath.length - 1];
    setNavPath(nextPath);
    setEditSubForm(null);

    if (target.type === 'group') {
      const targetGroup = groups.find((g) => g.id === target.id);
      setDetailGroup(targetGroup || null);
      setDetailMember(null);
      return;
    }

    if (target.type === 'member') {
      const prevGroup = [...nextPath].reverse().find((item) => item.type === 'group');
      const member = getMemberProfile(target.name, prevGroup?.name || 'Global Pool', usersByName, usersById);
      setDetailMember(member);
      setDetailGroup(null);
      setMemberTab('overview');
    }
  };

  const addMemberSubscription = () => {
    if (!editSubForm || !editSubForm.planId || !detailMember) return;
    const selectedPlan = activeSubscriptionPlans.find((plan) => plan.id === editSubForm.planId);
    if (!selectedPlan) return;

    setDetailMember((p) => ({
      ...p,
      subscriptions: [
        ...(p.subscriptions || []),
        {
          id: `sub-${Date.now()}`,
          name: selectedPlan.name,
          amount: `${selectedPlan.price}/${selectedPlan.validity}`,
          startDate: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
          status: 'Active',
        },
      ],
    }));
    setEditSubForm(null);
  };

  const removeMemberSubscription = (subId) => {
    if (!detailMember) return;
    setDetailMember((p) => ({
      ...p,
      subscriptions: (p.subscriptions || []).filter((sub, index) => (typeof sub === 'string' ? `sub-${index}` : sub.id) !== subId),
    }));
  };

  const applyTopupToMember = (plan) => {
    if (!detailMember) return;
    const topupAmount = Number(String(plan.price || '').replace(/[^\d]/g, '')) || 0;
    if (!window.confirm(`Apply ${plan.name} for ₹${topupAmount}?`)) return;

    const walletValue = Number(String(detailMember.wallet || '').replace(/[^\d]/g, '')) || 0;
    setDetailMember((p) => ({
      ...p,
      coins: (Number(p.coins) || 0) + (Number(plan.coins) || 0),
      wallet: `₹${walletValue + topupAmount}`,
    }));
  };

  return (
    <section className="page active space-y-4" id="page-groups">
      <div className="page-hero ph-groups">
        <div className="page-hero-left">
          <div className="page-hero-icon"><i className="fa fa-people-group"></i></div>
          <div className="page-hero-text">
            <h1>Community Clusters</h1>
            <p>Run high-engagement groups with member analytics, ride insights, and growth operations.</p>
          </div>
        </div>
        <div className="page-hero-right">
          <div className="page-hero-chips">
            <span className="page-hero-chip"><i className="fa fa-layer-group"></i> {groups.length} Groups</span>
            <span className="page-hero-chip"><i className="fa fa-users"></i> {groups.reduce((acc, g) => acc + g.members, 0)} Members</span>
          </div>
          <button className="btn-primary" onClick={() => setShowAdd(true)}><i className="fa fa-plus"></i> Create Group</button>
        </div>
      </div>

      <div className="groups-summary-strip">
        <div className="summary-stat"><i className="fa fa-layer-group"></i><span>{groups.length}</span><label>Total Groups</label></div>
        <div className="summary-stat"><i className="fa fa-users"></i><span>{groups.reduce((acc, g) => acc + g.members, 0)}</span><label>Total Members</label></div>
        <div className="summary-stat"><i className="fa fa-circle-check"></i><span>{groups.filter((g) => g.status === 'Active').length}</span><label>Active</label></div>
        <div className="summary-stat"><i className="fa fa-user-tie"></i><span>{new Set(groups.map((g) => g.founder).filter(Boolean)).size}</span><label>Founders</label></div>
      </div>

      <div className="toolbar">
        <div className="toolbar-left">
          <button className="btn-outline" onClick={() => visible[0] && openGroupDetail(visible[0])}><i className="fa fa-wave-square"></i> Engagement View</button>
          {selected.length > 0 && (
            <button className="btn-outline btn-outline-danger" onClick={bulkDelete}>
              <i className="fa fa-trash"></i> Delete Selected ({selected.length})
            </button>
          )}
        </div>
        <div className="toolbar-right">
          <button className={`btn-outline${fp.anyFiltered ? ' filter-btn-active' : ''}`} onClick={() => fp.setOpen(true)}>
            <i className="fa fa-filter"></i> Filter{fp.anyFiltered ? ` (${fp.filterCount})` : ''}
          </button>
        </div>
      </div>

      <div className="table-card full">
        <div className="table-wrap overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th><input type="checkbox" checked={selected.length === groups.length && groups.length > 0} onChange={(e) => toggleAll(e.target.checked)} /></th>
                <th>Group ID</th><th>Name</th><th>Members</th><th>Organization</th><th>Status</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((g) => (
                <tr key={g.id}>
                  <td><input type="checkbox" checked={selected.includes(g.id)} onChange={(e) => toggleRow(g.id, e.target.checked)} /></td>
                  <td><button className="link-btn" onClick={() => openGroupDetail(g)}>{g.id}</button></td>
                  <td><button className="link-btn" onClick={() => openGroupDetail(g)}><strong>{g.name}</strong></button></td>
                  <td><button className="link-btn" onClick={() => openGroupDetail(g)}>{g.members}</button></td>
                  <td>{g.org}</td>
                  <td><span className={`status ${g.status === 'Active' ? 'completed' : 'cancelled'}`}>{g.status}</span></td>
                  <td className="actions">
                    <button className="act-btn" title="Edit" onClick={() => openGroupDetail(g)}><i className="fa fa-pen"></i></button>
                    <button className="act-btn" title="Members" onClick={() => openGroupDetail(g)}><i className="fa fa-users"></i></button>
                    <button className="act-btn red" title="Delete" onClick={() => deleteRow(g.id)}><i className="fa fa-trash"></i></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <FilterPanel hook={fp} columns={COLUMNS} data={groups.map((g) => ({ ...g, members: String(g.members) }))} />

      <Modal open={showAdd} title="Create Group" onClose={() => setShowAdd(false)}
        footer={<><button className="btn-outline" onClick={() => setShowAdd(false)}>Cancel</button><button className="btn-primary" onClick={handleCreate}>Create</button></>}>
        <div className="form-grid">
          <div className="form-field full"><label>Group Name</label><input className="setting-input" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} placeholder="e.g. Campus Riders" /></div>
          <div className="form-field">
            <label>Organization</label>
            <select className="setting-input" value={form.org} onChange={(e) => setForm((p) => ({ ...p, org: e.target.value }))}>
              <option value="">Global Pool</option><option>North Campus</option><option>Tech Park Tower</option><option>City Public Mobility</option>
            </select>
          </div>
          <div className="form-field">
            <label>Group Type</label>
            <select className="setting-input" value={form.type} onChange={(e) => setForm((p) => ({ ...p, type: e.target.value }))}>
              <option>Rider</option><option>Admin</option><option>Operator</option>
            </select>
          </div>
        </div>
      </Modal>

      {detailGroup && (
        <Modal open={true} title={`Group Details: ${detailGroup.name}`} onClose={goBack} size="large"
          footer={<>
            {navPath.length > 1 && <button className="btn-outline" onClick={goBack}><i className="fa fa-arrow-left"></i> Back</button>}
            <button className="btn-outline" onClick={closeAllDetails}>Close</button>
          </>}>
          <div className="breadcrumb-nav">
            <span className="breadcrumb-item">Groups</span>
            {navPath.map((item, idx) => (
              <span key={`${item.type}-${item.id}-${idx}`}>
                <span className="breadcrumb-sep">/</span>
                <button className="breadcrumb-item" onClick={() => jumpToPath(idx)}>{item.name}</button>
              </span>
            ))}
          </div>
          <div className="detail-content">
            <div className="detail-grid">
              <div className="detail-section">
                <h4>Group Information</h4>
                <div className="detail-row"><label>Group ID</label><span className="mono">{detailGroup.id}</span></div>
                <div className="detail-row"><label>Group Name</label><span>{detailGroup.name}</span></div>
                <div className="detail-row"><label>Type</label><span>{detailGroup.type || 'Rider'}</span></div>
                <div className="detail-row"><label>Status</label><span className={`status ${detailGroup.status === 'Active' ? 'completed' : 'cancelled'}`}>{detailGroup.status}</span></div>
              </div>

              <div className="detail-section">
                <h4>Organization</h4>
                <div className="detail-row"><label>Organization</label><span>{detailGroup.org}</span></div>
                <div className="detail-row"><label>Founder</label><span>{detailGroup.founder || 'N/A'}</span></div>
                <div className="detail-row"><label>Created</label><span>{detailGroup.created || 'N/A'}</span></div>
                <div className="detail-row"><label>Members</label><span>{detailGroup.members}</span></div>
              </div>

              <div className="detail-section" style={{ gridColumn: '1 / -1' }}>
                <h4>Description</h4>
                <p style={{ color: 'var(--text-1)', margin: 0 }}>{detailGroup.description || 'No description available.'}</p>
              </div>

              <div className="detail-section">
                <h4>Ride Stats</h4>
                <div className="detail-row"><label>Total Rides</label><span>{detailGroup.ridesTotal ?? 0}</span></div>
                <div className="detail-row"><label>Active</label><span>{detailGroup.ridesActive ?? 0}</span></div>
                <div className="detail-row"><label>Completed</label><span>{detailGroup.ridesCompleted ?? 0}</span></div>
                <div className="detail-row"><label>Cancelled</label><span>{detailGroup.ridesCancelled ?? 0}</span></div>
              </div>

              <div className="detail-section">
                <h4>Members</h4>
                <div className="groups-list" style={{ marginTop: '6px' }}>
                  {(detailGroup.membersList && detailGroup.membersList.length > 0)
                    ? detailGroup.membersList.map((member) => (
                      <button key={member} className="group-item" onClick={() => openMemberDetail(member)}>
                        <i className="fa fa-user"></i> {member}
                      </button>
                    ))
                    : <span className="text-muted">No members added yet</span>}
                </div>
              </div>
            </div>
          </div>
        </Modal>
      )}

      {detailMember && (
        <Modal open={true} title={`User Details: ${detailMember.name}`} onClose={goBack} size="large"
          footer={<>
            {navPath.length > 1 && <button className="btn-outline" onClick={goBack}><i className="fa fa-arrow-left"></i> Back</button>}
            <button className="btn-outline" onClick={closeAllDetails}>Close</button>
          </>}>
          <div className="breadcrumb-nav">
            <span className="breadcrumb-item">Groups</span>
            {navPath.map((item, idx) => (
              <span key={`${item.type}-${item.id}-${idx}`}>
                <span className="breadcrumb-sep">/</span>
                <button className="breadcrumb-item" onClick={() => jumpToPath(idx)}>{item.name}</button>
              </span>
            ))}
          </div>
          <div className="detail-tabs">
            <div className="tab-buttons">
              <button className={`tab-btn${memberTab === 'overview' ? ' active' : ''}`} onClick={() => setMemberTab('overview')}><i className="fa fa-user"></i> Overview</button>
              <button className={`tab-btn${memberTab === 'rides' ? ' active' : ''}`} onClick={() => setMemberTab('rides')}><i className="fa fa-car"></i> Rides</button>
              <button className={`tab-btn${memberTab === 'subs' ? ' active' : ''}`} onClick={() => setMemberTab('subs')}><i className="fa fa-receipt"></i> Subscriptions</button>
              <button className={`tab-btn${memberTab === 'groups' ? ' active' : ''}`} onClick={() => setMemberTab('groups')}><i className="fa fa-users"></i> Groups</button>
              <button className={`tab-btn${memberTab === 'achievements' ? ' active' : ''}`} onClick={() => setMemberTab('achievements')}><i className="fa fa-trophy"></i> Achievements</button>
            </div>

            {memberTab === 'overview' && (
              <div className="detail-content">
                <div className="detail-grid">
                  <div className="detail-section">
                    <h4>Contact Information</h4>
                    <div className="detail-row"><label>Name</label><span>{detailMember.name}</span></div>
                    <div className="detail-row"><label>Email</label><span>{detailMember.email}</span></div>
                    <div className="detail-row"><label>Mjollnir ID</label><span className="mono">{detailMember.id}</span></div>
                    <div className="detail-row"><label>Emp / Student ID</label><span className="mono">{detailMember.empId}</span></div>
                  </div>

                  <div className="detail-section">
                    <h4>Organization Information</h4>
                    <div className="detail-row"><label>Business Type</label><span>{detailMember.businessType}</span></div>
                    <div className="detail-row"><label>Organization Type</label><span>{detailMember.orgType}</span></div>
                    <div className="detail-row"><label>Organization Name</label><span>{detailMember.orgName}</span></div>
                  </div>

                  <div className="detail-section">
                    <h4>Account Details</h4>
                    <div className="detail-row"><label>Role</label><span>{detailMember.role}</span></div>
                    <div className="detail-row"><label>Status</label><span className={`status ${statusClass[detailMember.status]}`}>{detailMember.status}</span></div>
                    <div className="detail-row"><label>Joined</label><span>{detailMember.joined}</span></div>
                  </div>

                  <div className="detail-section">
                    <h4>Financial Information</h4>
                    <div className="detail-row"><label>Coins</label><span>{detailMember.coins}</span></div>
                    <div className="detail-row"><label>Wallet Balance</label><span>{detailMember.wallet}</span></div>
                  </div>

                  <div className="detail-section">
                    <h4>Location</h4>
                    <div className="detail-row"><label>Live Coordinates</label><span className="mono">{detailMember.location}</span></div>
                  </div>
                </div>
              </div>
            )}

            {memberTab === 'rides' && (
              <div className="detail-content">
                <div className="stats-grid">
                  <div className="stat-box"><div className="stat-value">{memberRideStats.total}</div><div className="stat-label">Total Rides</div></div>
                  <div className="stat-box"><div className="stat-value">{memberRideStats.active}</div><div className="stat-label">Active</div></div>
                  <div className="stat-box"><div className="stat-value">{memberRideStats.completed}</div><div className="stat-label">Completed</div></div>
                  <div className="stat-box"><div className="stat-value">{memberRideStats.cancelled}</div><div className="stat-label">Cancelled</div></div>
                </div>

                <div className="ride-completion">
                  <h4>Completion Rate</h4>
                  <div className="progress-bar">
                    <div className="progress-fill" style={{ width: `${memberRideStats.completionRate}%` }}></div>
                  </div>
                  <span>{memberRideStats.completionRate}% of rides completed</span>
                </div>

                <div className="rides-detail-grid">
                  <div className="detail-section rides-breakdown-card">
                    <h4>Ride Breakdown</h4>
                    {getRideSummaryRows({
                      ...detailMember,
                      rides: memberRideStats.total,
                      activeRides: memberRideStats.active,
                      completedRides: memberRideStats.completed,
                      cancelledRides: memberRideStats.cancelled,
                    }).map((item) => (
                      <div key={item.label} className="ride-breakdown-row">
                        <div>
                          <div className="ride-breakdown-label">{item.label}</div>
                          <div className="ride-breakdown-hint">{item.hint}</div>
                        </div>
                        <div className="ride-breakdown-value">{item.value}</div>
                      </div>
                    ))}
                  </div>

                  <div className="detail-section rides-log-card">
                    <h4>All Ride Details ({allMemberRides.length})</h4>
                    <div className="ride-log-list ride-log-list-all">
                      {allMemberRides.map((ride) => (
                        <div key={ride.id} className="ride-log-item">
                          <div className="ride-log-top">
                            <span className="mono">{ride.id}</span>
                            <span className={`status ${statusClass[ride.status] || (ride.status === 'Completed' ? 'completed' : ride.status === 'Active' ? 'pending' : 'cancelled')}`}>{ride.status}</span>
                          </div>
                          <div className="ride-log-route">{ride.route}</div>
                          <div className="ride-log-meta">
                            <span>{ride.date}</span>
                            <span>{ride.vehicle}</span>
                            <span>{ride.fare}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {memberTab === 'subs' && (
              <div className="detail-content">
                <div className="subs-list">
                  {memberSubscriptions.length > 0
                    ? memberSubscriptions.map((sub) => (
                      <div key={sub.id} className="sub-item">
                        <div className="sub-header">
                          <div className="sub-name">{sub.name}</div>
                          <span className={`status ${statusClass[sub.status] || 'completed'}`}>{sub.status}</span>
                          <button className="act-btn red" onClick={() => removeMemberSubscription(sub.id)} title="Remove Subscription"><i className="fa fa-trash"></i></button>
                        </div>
                        <div className="sub-details">
                          <span><strong>{sub.amount}</strong></span>
                          <span className="muted">Started: {sub.startDate}</span>
                        </div>
                      </div>
                    ))
                    : <div className="empty-state">No subscriptions</div>}
                </div>

                <div className="add-sub-form">
                  <h4>Add New Subscription</h4>
                  {!editSubForm ? (
                    <button className="btn-outline" onClick={() => setEditSubForm({ planId: activeSubscriptionPlans[0]?.id || '' })}><i className="fa fa-plus"></i> Add Subscription</button>
                  ) : (
                    <div className="form-row">
                      <select className="setting-input" value={editSubForm.planId} onChange={(e) => setEditSubForm({ ...editSubForm, planId: e.target.value })}>
                        {activeSubscriptionPlans.map((plan) => (
                          <option key={plan.id} value={plan.id}>{plan.name} — {plan.price} / {plan.validity}</option>
                        ))}
                      </select>
                      <button className="btn-primary" onClick={addMemberSubscription}><i className="fa fa-check"></i> Add</button>
                      <button className="btn-outline" onClick={() => setEditSubForm(null)}>Cancel</button>
                    </div>
                  )}
                </div>

                <div className="add-sub-form topup-section">
                  <h4>Topup Plans</h4>
                  {activeTopupPlans.length > 0 ? (
                  <div className="topup-grid">
                    {activeTopupPlans.map((plan) => (
                      <div key={plan.id} className="topup-card">
                        <div className="topup-title">{plan.name}</div>
                        <div className="topup-coins">+{plan.coins} coins</div>
                        <div className="topup-meta">
                          <span>Bonus: +{plan.daily || 0}</span>
                          <strong>{plan.price}</strong>
                        </div>
                        <button className="btn-outline" onClick={() => applyTopupToMember(plan)}>
                          <i className="fa fa-bolt"></i> Apply Topup
                        </button>
                      </div>
                    ))}
                  </div>
                  ) : (
                    <div className="empty-state">No active topup plans. Create one in Subscriptions page with type Topup.</div>
                  )}
                </div>
              </div>
            )}

            {memberTab === 'groups' && (
              <div className="detail-content">
                <div className="groups-list">
                  {detailMember.groups.length > 0
                    ? detailMember.groups.map((group) => <button key={group} className="group-item" onClick={() => openGroupFromMemberTab(group)}><i className="fa fa-users"></i> {group}</button>)
                    : <div className="empty-state">No groups</div>}
                </div>
              </div>
            )}

            {memberTab === 'achievements' && (
              <div className="detail-content">
                <div className="achievements-list">
                  {detailMember.achievements.length > 0
                    ? detailMember.achievements.map((ach) => <span key={ach} className="achievement-item"><i className="fa fa-star"></i> {ach}</span>)
                    : <div className="empty-state">No achievements yet</div>}
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}
    </section>
  );
}
