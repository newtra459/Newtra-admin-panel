import { useState, useMemo, useEffect } from 'react';
import Modal from '../../components/Modal';
import { useFilterPanel, FilterPanel } from '../../components/ColumnFilter';
import { loadSubscriptionPlans, saveSubscriptionPlans } from '../../config/subscription-plans';
import { BUSINESS_SETUP_UPDATED_EVENT, getActiveVehicleTypes, loadBusinessSetup } from '../../config/business-setup';
import { isApiIntegrationEnabled } from '../../api/runtime';
import { createSubscription, deleteSubscription, getSubscriptionUsers, listSubscriptions, updateSubscription } from '../../api/services/subscriptionsService';

const COLUMNS = [
  { key: 'id',       label: 'Plan ID' },
  { key: 'type',     label: 'Type' },
  { key: 'name',     label: 'Name',          type: 'text' },
  { key: 'price',    label: 'Price',         type: 'text' },
  { key: 'validity', label: 'Validity' },
  { key: 'vehicles', label: 'Vehicle Types', type: 'text' },
  { key: 'coins',    label: 'Coins',         type: 'text' },
  { key: 'daily',    label: 'Daily Coins',   type: 'text' },
  { key: 'limit',    label: 'Time Limit',    type: 'text' },
  { key: 'status',   label: 'Status' },
];

function blankForm() {
  return { type: 'Subscription', name: '', price: '', validity: '30 days', vehicles: [], coins: '', daily: '', limit: '', status: 'Active' };
}

const DELETED_SUBS_KEY = 'newtra:deleted-subscription-ids';

function loadDeletedSubIds(): Set<string> {
  try {
    const raw = localStorage.getItem(DELETED_SUBS_KEY);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch { return new Set(); }
}

function saveDeletedSubId(id: string): void {
  try {
    const existing = loadDeletedSubIds();
    existing.add(id);
    localStorage.setItem(DELETED_SUBS_KEY, JSON.stringify([...existing]));
  } catch {}
}

export default function SubscriptionsPage() {
  const usingApi = isApiIntegrationEnabled();
  const [businessSetup, setBusinessSetup] = useState(loadBusinessSetup);
  const [plans,   setPlans]   = useState(loadSubscriptionPlans);
  const [showAdd, setShowAdd] = useState(false);
  const [editingPlanId, setEditingPlanId] = useState(null);
  const [form,    setForm]    = useState(blankForm());
  const [plansMode, setPlansMode] = useState(usingApi ? 'API' : 'Local');
  const [plansSyncError, setPlansSyncError] = useState('');
  const [isPlansLoading, setIsPlansLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [linkedUserCounts, setLinkedUserCounts] = useState<Record<string, number>>({});
  const [isLinkedCountsLoading, setIsLinkedCountsLoading] = useState(false);
  const fp = useFilterPanel();
  const vehicleOptions = useMemo(() => {
    return getActiveVehicleTypes(businessSetup).map((item) => item.name);
  }, [businessSetup]);

  useEffect(() => {
    saveSubscriptionPlans(plans);
  }, [plans]);

  useEffect(() => {
    const reloadBusinessSetup = () => setBusinessSetup(loadBusinessSetup());
    window.addEventListener(BUSINESS_SETUP_UPDATED_EVENT, reloadBusinessSetup);
    return () => window.removeEventListener(BUSINESS_SETUP_UPDATED_EVENT, reloadBusinessSetup);
  }, []);

  useEffect(() => {
    if (!usingApi) return;
    let mounted = true;

    const hydratePlans = async () => {
      setIsPlansLoading(true);
      setPlansSyncError('');
      try {
        const remoteRows = await listSubscriptions({ page: 1, limit: 300 });
        if (!mounted) return;
        if (Array.isArray(remoteRows) && remoteRows.length) {
          // Hide inactive plans AND locally-deleted plan IDs from view.
          const deletedIds = loadDeletedSubIds();
          setPlans(remoteRows.filter((row) => row.status !== 'Inactive' && !deletedIds.has(String(row.id || row.apiId || ''))));
          setPlansMode('API');
        } else {
          setPlansMode('Local');
        }
      } catch (error) {
        if (!mounted) return;
        setPlansMode('Local');
        setPlansSyncError(error?.message || 'Unable to sync subscriptions from backend.');
      } finally {
        if (mounted) setIsPlansLoading(false);
      }
    };

    hydratePlans();
    return () => {
      mounted = false;
    };
  }, [usingApi]);

  useEffect(() => {
    if (!usingApi || !plans.length) {
      setLinkedUserCounts({});
      return;
    }

    let mounted = true;
    setIsLinkedCountsLoading(true);

    Promise.all(
      plans.map(async (plan) => {
        const count = await getLinkedUsersCount(plan);
        return [plan.id, count] as const;
      })
    )
      .then((rows) => {
        if (!mounted) return;
        const next: Record<string, number> = {};
        rows.forEach(([id, count]) => {
          next[id] = count;
        });
        setLinkedUserCounts(next);
      })
      .finally(() => {
        if (mounted) setIsLinkedCountsLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [usingApi, plans]);

  const reportPlansApiError = (actionLabel, error) => {
    const raw = String(error?.message || 'Unknown error').trim();
    const clean = raw.endsWith('.') ? raw.slice(0, -1) : raw;
    setPlansSyncError(`${actionLabel} failed in API mode: ${clean}. Data not changed locally.`);
  };

  const getLinkedUsersCount = async (plan) => {
    const subId = String(plan?.apiId || plan?.id || '');
    if (!subId) return 0;
    try {
      const payload = await getSubscriptionUsers(subId);
      const data = (payload && typeof payload === 'object') ? payload.data : null;
      if (Array.isArray(data)) return data.length;
      if (data && Array.isArray(data.items)) return data.items.length;
      return 0;
    } catch {
      return 0;
    }
  };

  const deactivatePlanFallback = async (plan, linkedCount) => {
    setPlansSyncError(
      `Cannot delete ${plan.name || plan.id}: backend still reports ${linkedCount} linked user(s). Remove the linked user subscription record first, then retry delete.`
    );
    return false;
  };

  const softDeletePlanFallback = async (plan, reason = 'Hard delete failed on server.') => {
    try {
      await updateSubscription({ ...plan, status: 'Inactive' });
    } catch {
      // Backend may not persist but we still remove from view.
    }
    // Always persist the deleted ID locally so re-fetch won't show it again.
    saveDeletedSubId(String(plan.apiId || plan.id || ''));
    setPlans((rows) => rows.filter((row) => row.id !== plan.id));
    setSelectedIds((s) => { const n = new Set(s); n.delete(plan.id); return n; });
    setPlansSyncError(`Plan "${plan.name || plan.id}" removed from view. (Backend note: ${reason})`);
    return true;
  };

  const flat = useMemo(() => plans.map((p) => ({ ...p, vehicles: p.vehicles.join(', '), coins: String(p.coins), daily: String(p.daily), limit: String(p.limit) })), [plans]);
  const visible = useMemo(() => flat.filter((p) => COLUMNS.every((c) => fp.match(c.key, p[c.key]))), [flat, fp.filters]);
  const visibleFull = useMemo(() => plans.filter((p) => visible.some((v) => v.id === p.id)), [plans, visible]);

  const f = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }));
  const toggleVehicle = (v) => setForm((p) => ({
    ...p, vehicles: p.vehicles.includes(v) ? p.vehicles.filter((x) => x !== v) : [...p.vehicles, v],
  }));

  const handleCreate = async () => {
    if (!form.name.trim() || !form.price.trim()) return;
    if (!form.vehicles.length && !vehicleOptions.length) {
      window.alert('Add at least one active vehicle type in Settings before creating a plan.');
      return;
    }

    const localPayload = {
      id: editingPlanId || `${form.type === 'Topup' ? 'TOP' : 'SUB'}-${String(plans.length + 1).padStart(3, '0')}`,
      type: form.type,
      name: form.name,
      price: form.price,
      validity: form.validity,
      vehicles: form.vehicles.length ? form.vehicles : [vehicleOptions[0] || ''],
      coins: Number(form.coins) || 0,
      daily: Number(form.daily) || 0,
      limit: Number(form.limit) || 30,
      status: form.status,
    };

    if (usingApi) {
      try {
        if (editingPlanId) {
          const updated = await updateSubscription(localPayload);
          setPlans((current) => current.map((plan) => (plan.id === editingPlanId ? { ...plan, ...updated } : plan)));
        } else {
          const created = await createSubscription(localPayload);
          setPlans((p) => [...p, created]);
        }

        setEditingPlanId(null);
        setForm(blankForm());
        setShowAdd(false);
        return;
      } catch (error) {
        reportPlansApiError(editingPlanId ? 'Update subscription' : 'Create subscription', error);
        return;
      }
    }

    if (editingPlanId) {
      setPlans((current) => current.map((plan) => (plan.id === editingPlanId ? { ...plan, ...localPayload } : plan)));
    } else {
      setPlans((p) => [...p, localPayload]);
    }

    setEditingPlanId(null);
    setForm(blankForm());
    setShowAdd(false);
  };

  const openCreate = () => {
    setEditingPlanId(null);
    setForm(blankForm());
    setShowAdd(true);
  };

  const openEdit = (plan) => {
    setEditingPlanId(plan.id);
    setForm({
      type: plan.type || 'Subscription',
      name: plan.name,
      price: plan.price,
      validity: plan.validity,
      vehicles: plan.vehicles,
      coins: String(plan.coins),
      daily: String(plan.daily),
      limit: String(plan.limit),
      status: plan.status,
    });
    setShowAdd(true);
  };

  const openDesigner = () => {
    setShowAdd(true);
  };

  const deletePlan = async (plan) => {
    if (!window.confirm('Delete this subscription plan?')) return;
    if (usingApi && plansMode === 'API') {
      const linkedCount = await getLinkedUsersCount(plan);
      if (linkedCount > 0) {
        await deactivatePlanFallback(plan, linkedCount);
        return;
      }
      try {
        await deleteSubscription(plan);
        saveDeletedSubId(String(plan.apiId || plan.id || ''));
        setPlans((p) => p.filter((r) => r.id !== plan.id));
        setSelectedIds((s) => { const n = new Set(s); n.delete(plan.id); return n; });
        return;
      } catch (error) {
        const fallbackReason = String(error?.message || 'Unknown backend error');
        const softDeleted = await softDeletePlanFallback(plan, fallbackReason);
        if (!softDeleted) reportPlansApiError('Delete subscription', error);
        return; // do NOT remove from local state when API fails
      }
    }
    setPlans((p) => p.filter((r) => r.id !== plan.id));
    setSelectedIds((s) => { const n = new Set(s); n.delete(plan.id); return n; });
  };

  const deleteSelected = async () => {
    if (!selectedIds.size) return;
    if (!window.confirm(`Delete ${selectedIds.size} selected plan(s)?`)) return;
    const toDelete = visibleFull.filter((p) => selectedIds.has(p.id));
    for (const plan of toDelete) {
      if (usingApi && plansMode === 'API') {
        const linkedCount = await getLinkedUsersCount(plan);
        if (linkedCount > 0) {
          await deactivatePlanFallback(plan, linkedCount);
          continue;
        }
        try {
          await deleteSubscription(plan);
        } catch (error) {
          const fallbackReason = String(error?.message || 'Unknown backend error');
          const softDeleted = await softDeletePlanFallback(plan, fallbackReason);
          if (!softDeleted) reportPlansApiError(`Delete subscription (${plan.id})`, error);
          continue; // skip local removal if API fails
        }
      }
      setPlans((p) => p.filter((r) => r.id !== plan.id));
    }
    setSelectedIds(new Set());
  };

  const toggleSelect = (id: string) => setSelectedIds((s) => {
    const n = new Set(s);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });

  const allVisibleSelected = visibleFull.length > 0 && visibleFull.every((p) => selectedIds.has(p.id));
  const someSelected = selectedIds.size > 0;

  const toggleSelectAll = () => {
    if (allVisibleSelected) {
      setSelectedIds((s) => { const n = new Set(s); visibleFull.forEach((p) => n.delete(p.id)); return n; });
    } else {
      setSelectedIds((s) => { const n = new Set(s); visibleFull.forEach((p) => n.add(p.id)); return n; });
    }
  };

  return (
    <section className="page active space-y-4" id="page-subscriptions">
      <div className="page-hero ph-subscriptions">
        <div className="page-hero-left">
          <div className="page-hero-icon"><i className="fa fa-crown"></i></div>
          <div className="page-hero-text">
            <h1>Plan Portfolio</h1>
            <p>Design subscription and top-up plans with vehicle permissions, coins, and time-limit controls.</p>
          </div>
        </div>
        <div className="page-hero-right">
          <div className="page-hero-chips">
            <span className="page-hero-chip"><i className="fa fa-cubes"></i> {plans.length} Plans</span>
            <span className="page-hero-chip"><i className="fa fa-circle-check"></i> {plans.filter((p) => p.status === 'Active').length} Active</span>
          </div>
          <button className="btn-primary" onClick={openCreate}><i className="fa fa-plus"></i> Create Plan</button>
        </div>
      </div>

      <div className="toolbar">
        <div className="toolbar-left">
          <button className="btn-outline" onClick={openDesigner}><i className="fa fa-sparkles"></i> Plan Designer</button>
        </div>
        <div className="toolbar-right" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {someSelected && (
            <button className="btn-outline" style={{ color: 'var(--color-danger, #f87171)', borderColor: 'var(--color-danger, #f87171)' }} onClick={deleteSelected}>
              <i className="fa fa-trash"></i> Delete ({selectedIds.size})
            </button>
          )}
          <button className={`btn-outline${fp.anyFiltered ? ' filter-btn-active' : ''}`} onClick={() => fp.setOpen(true)}>
            <i className="fa fa-filter"></i> Filter{fp.anyFiltered ? ` (${fp.filterCount})` : ''}
          </button>
        </div>
      </div>

      <div className="table-card full" style={{ padding: '8px 12px' }}>
        <div className="flex flex-wrap items-center justify-between gap-2 text-[12px]">
          <span className={`badge-pill ${plansMode === 'API' ? '' : 'bg-amber-500/20 text-amber-300'}`}>
            <i className={`fa ${plansMode === 'API' ? 'fa-plug-circle-check' : 'fa-database'}`}></i>&nbsp;
            Subscriptions Mode: {plansMode}
          </span>
          {isPlansLoading ? <span className="text-[11px] opacity-80">Syncing plans from backend...</span> : null}
          {isLinkedCountsLoading ? <span className="text-[11px] opacity-80">Loading linked user counts...</span> : null}
          {plansSyncError ? <span className="text-[11px] text-rose-300">{plansSyncError}</span> : null}
        </div>
      </div>

      <div className="sub-cards-grid">
        {visibleFull.map((p) => (
          <div className="sub-plan-card rounded-2xl p-4 md:p-5" key={`sub-${p.id}`}>
            <div className="sub-card-meta">{p.id} • {p.type}</div>
            <div className="sub-card-price">{p.price}</div>
            <div className="sub-card-coins">Linked users: {linkedUserCounts[p.id] ?? 0}</div>
            <div className="sub-card-vehicles">
              {p.vehicles.map((v) => <span key={`${p.id}-${v}`} className="badge-pill">{v}</span>)}
            </div>
            <div className="sub-card-coins">{p.coins} signup / {p.daily} daily coins</div>
            <div className="sub-card-footer flex items-center justify-between gap-2">
              <span>{p.validity} • {p.limit} min</span>
              <span className={`status ${p.status === 'Active' ? 'completed' : 'cancelled'}`}>{p.status}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="table-card full">
        <div className="table-wrap overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: '36px' }}><input type="checkbox" checked={allVisibleSelected} onChange={toggleSelectAll} style={{ cursor: 'pointer' }} /></th>
                <th>Plan ID</th><th>Type</th><th>Name</th><th>Price</th><th>Validity</th><th>Vehicle Types</th>
                <th>Coins</th><th>Daily Coins</th><th>Time Limit</th><th>Status</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {visibleFull.map((p) => (
                <tr key={p.id} style={selectedIds.has(p.id) ? { background: 'rgba(0,168,119,0.08)' } : {}}>
                  <td><input type="checkbox" checked={selectedIds.has(p.id)} onChange={() => toggleSelect(p.id)} style={{ cursor: 'pointer' }} /></td>
                  <td>{p.id}</td>
                  <td><span className="badge-pill">{p.type || 'Subscription'}</span></td>
                  <td><strong>{p.name}</strong></td>
                  <td>{p.price}</td>
                  <td>{p.validity}</td>
                  <td><div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>{p.vehicles.map((v) => <span key={v} className="badge-pill">{v}</span>)}</div></td>
                  <td>{p.coins}</td>
                  <td>{p.daily}</td>
                  <td>{p.limit} min</td>
                  <td>
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                      <span className={`status ${p.status === 'Active' ? 'completed' : 'cancelled'}`}>{p.status}</span>
                      <span className="badge-pill">Users: {linkedUserCounts[p.id] ?? 0}</span>
                    </div>
                  </td>
                  <td className="actions">
                    <button className="act-btn" title="Edit" onClick={() => openEdit(p)}><i className="fa fa-pen"></i></button>
                    <button className="act-btn red" title="Delete" onClick={() => deletePlan(p)}><i className="fa fa-trash"></i></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <FilterPanel hook={fp} columns={COLUMNS} data={flat} />

      <Modal open={showAdd} title={editingPlanId ? 'Edit Subscription Plan' : 'Create Subscription Plan'} onClose={() => { setShowAdd(false); setEditingPlanId(null); }} size="lg"
        footer={<><button className="btn-outline" onClick={() => { setShowAdd(false); setEditingPlanId(null); }}>Cancel</button><button className="btn-primary" onClick={handleCreate}>{editingPlanId ? 'Update Plan' : 'Create Plan'}</button></>}>
        <div className="form-grid">
          <div className="form-field full"><label>Plan Name</label><input className="setting-input" value={form.name} onChange={f('name')} placeholder="e.g. Campus Monthly" /></div>
          <div className="form-field"><label>Type</label>
            <select className="setting-input" value={form.type} onChange={f('type')}>
              <option>Subscription</option><option>Topup</option>
            </select>
          </div>
          <div className="form-field"><label>Price</label><input className="setting-input" value={form.price} onChange={f('price')} placeholder="₹499" /></div>
          <div className="form-field"><label>Validity</label>
            <select className="setting-input" value={form.validity} onChange={f('validity')}>
              <option>1 day</option><option>3 days</option><option>7 days</option><option>30 days</option><option>90 days</option><option>365 days</option>
            </select>
          </div>
          <div className="form-field full">
            <label>Allowed Vehicle Types</label>
            <div className="check-group">
              {!vehicleOptions.length && <span style={{ color: 'var(--text-2)', fontSize: '12px' }}>No active vehicle types in Settings.</span>}
              {vehicleOptions.map((v) => (
                <label key={v} className="check-item">
                  <input type="checkbox" checked={form.vehicles.includes(v)} onChange={() => toggleVehicle(v)} /> {v}
                </label>
              ))}
            </div>
          </div>
          <div className="form-field"><label>Coins on Sign-up</label><input type="number" className="setting-input" value={form.coins} onChange={f('coins')} placeholder="100" /></div>
          <div className="form-field"><label>Daily Coins</label><input type="number" className="setting-input" value={form.daily} onChange={f('daily')} placeholder="5" /></div>
          <div className="form-field"><label>Ride Time Limit (min)</label><input type="number" className="setting-input" value={form.limit} onChange={f('limit')} placeholder="45" /></div>
          <div className="form-field"><label>Status</label>
            <select className="setting-input" value={form.status} onChange={f('status')}>
              <option>Active</option><option>Inactive</option>
            </select>
          </div>
        </div>
      </Modal>
    </section>
  );
}
