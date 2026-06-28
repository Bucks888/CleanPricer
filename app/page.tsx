'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Sparkles,
  RefreshCw,
  ArrowRight,
  Database,
  Settings,
  Search,
  ChevronLeft,
  Activity,
  History,
  TrendingUp,
  FileArchive,
  UploadCloud,
  FileText,
  CheckCircle2,
  AlertTriangle,
  Info,
  Filter,
  X,
  LayoutDashboard,
  Archive,
  ListChecks,
  BookOpen,
  Users,
  ZapOff,
  Cpu,
  Mail,
  Phone,
  MapPin,
  Map,
  Plus,
  Download,
  LogIn,
  Shield,
  LockKeyhole
} from 'lucide-react';

// Live dashboard stats type
interface DashboardStats {
  documents: {
    pending: number;
    processing: number;
    done: number;
    error: number;
    needs_review: number;
  };
  total_items: number;
  matched_items: number;
  unmatched_items: number;
  unverified_items: number;
  normalization_rate: number;
}

// Live price document type
interface PriceDocument {
  doc_id: string;
  partner_id: string;
  file_name: string;
  file_format: string;
  effective_date: string;
  parsed_at: string;
  parse_status: 'pending' | 'processing' | 'done' | 'error' | 'needs_review';
  parse_log: string;
  partner_name?: string;
}

// Live catalog service type
interface CatalogService {
  service_id: string;
  service_name: string;
  synonyms: string[];
  category: string;
  icd_code?: string;
  is_active: boolean;
}

// Live clinic partner type
interface ClinicPartner {
  partner_id: string;
  name: string;
  city: string;
  address: string;
  bin: string;
  contact_email: string;
  contact_phone: string;
  is_active: boolean;
  created_at: string;
}

type ActiveTab =
  | 'dashboard'
  | 'archive_processing'
  | 'price_documents'
  | 'verification_queue'
  | 'service_catalog'
  | 'partners'
  | 'price_explorer'
  | 'unmatched_services'
  | 'api_center'
  | 'settings';

type SettingsUpdate = Partial<{
  autoCategory: boolean;
  defaultCurrency: string;
  autoMatchThreshold: number;
  manualReviewThreshold: number;
  usdRate: number;
  rubRate: number;
}>;

type ExplorerClinicResult = {
  partner_id: string;
  partner_name: string;
  price_resident_kzt: number;
  price_nonresident_kzt: number;
  price_original: number;
  currency_original: string;
  effective_date: string;
  is_verified: boolean;
  verification_note?: string;
  city?: string;
  address?: string;
  bin?: string;
  contact_email?: string;
  contact_phone?: string;
};

// Live price item type
interface PriceItem {
  item_id: string;
  doc_id: string;
  partner_id: string;
  service_name_raw: string;
  service_name_normalized?: string;
  service_code_source?: string;
  service_id?: string;
  price_resident_kzt: number;
  price_nonresident_kzt: number;
  price_original: number;
  currency_original: string;
  is_verified: boolean;
  is_active?: boolean;
  verification_note?: string;
  effective_date: string;
  partner_name?: string;
  file_name?: string;
}

function renderStructuredLogs(logString: string) {
  if (!logString) return <span className="text-slate-400">Лог чист</span>;
  const cleanLog = logString.trim();
  if (!cleanLog.startsWith('[')) {
    return <span className="text-slate-500">{logString}</span>;
  }

  try {
    const logs = JSON.parse(cleanLog) as Array<{
      type?: string;
      row?: string | number;
      message?: string;
    }>;
    if (logs.length === 0) return <span className="text-slate-400">Лог чист</span>;

    return (
      <div className="flex flex-col gap-1 max-w-[280px]">
        {logs.slice(0, 2).map((log, idx) => (
          <div
            key={idx}
            className={`p-1 rounded text-[10px] flex items-center gap-1 border ${
              log.type === 'error'
                ? 'bg-rose-50 border-rose-150 text-rose-700'
                : 'bg-amber-50 border-amber-150 text-amber-700'
            }`}
          >
            <span className="font-extrabold uppercase text-[7px] tracking-wider px-1 bg-white rounded border border-current">
              {log.type === 'error' ? 'Ошибка' : 'Ревью'}
            </span>
            <span className="truncate">
              {log.row ? `Стр. ${log.row}: ` : ''}
              {log.message ?? ''}
            </span>
          </div>
        ))}
        {logs.length > 2 && (
          <span className="text-[9px] text-slate-400 pl-1 font-bold">
            Еще {logs.length - 2} записей...
          </span>
        )}
      </div>
    );
  } catch (e) {
    return <span className="text-rose-600 font-mono">{logString}</span>;
  }
}

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('dashboard');

  const [isSidebarExpanded, setIsSidebarExpanded] = useState(true);
  
  // Data lists
  const [stats, setStats] = useState<DashboardStats>({
    documents: { pending: 0, processing: 0, done: 0, error: 0, needs_review: 0 },
    total_items: 0,
    matched_items: 0,
    unmatched_items: 0,
    unverified_items: 0,
    normalization_rate: 0
  });
  const [documents, setDocuments] = useState<PriceDocument[]>([]);
  const [services, setServices] = useState<CatalogService[]>([]);
  const [partners, setPartners] = useState<ClinicPartner[]>([]);
  const [unmatchedItems, setUnmatchedItems] = useState<PriceItem[]>([]);
  const [verifiedItems, setVerifiedItems] = useState<PriceItem[]>([]);
  
  // File upload state
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadMessage, setUploadMessage] = useState('');
  
  // Selection and Search states
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'info' | 'error' } | null>(null);

  // Unmatched Mapping screen states
  const [selectedUnmatchedItem, setSelectedUnmatchedItem] = useState<PriceItem | null>(null);
  const [mappingSearch, setMappingSearch] = useState('');
  const [mappingNote, setMappingNote] = useState('');

  // Catalog seeding states
  const [catalogFileUploading, setCatalogFileUploading] = useState(false);

  // Price Explorer Search
  const [explorerQuery, setExplorerQuery] = useState('');
  const [explorerResults, setExplorerResults] = useState<{ partners: ClinicPartner[]; services: CatalogService[] }>({
    partners: [],
    services: []
  });
  const [selectedExplorerService, setSelectedExplorerService] = useState<CatalogService | null>(null);
  const [explorerServiceClinics, setExplorerServiceClinics] = useState<ExplorerClinicResult[]>([]);

  // Settings
  const [autoCategory, setAutoCategory] = useState(true);
  const [defaultCurrency, setDefaultCurrency] = useState('KZT');
  const [autoMatchThreshold, setAutoMatchThreshold] = useState(0.85);
  const [manualReviewThreshold, setManualReviewThreshold] = useState(0.70);
  const [usdRate, setUsdRate] = useState(450.0);
  const [rubRate, setRubRate] = useState(5.0);

  const [authState, setAuthState] = useState<'loading' | 'authed' | 'guest'>('loading');
  const [loginUsername, setLoginUsername] = useState('admin');
  const [loginPassword, setLoginPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [authSubmitting, setAuthSubmitting] = useState(false);

  // Price History Modal States
  const [historyModalOpen, setHistoryModalOpen] = useState(false);
  const [historyItems, setHistoryItems] = useState<PriceItem[]>([]);
  const [historyPartnerName, setHistoryPartnerName] = useState('');
  const [historyServiceName, setHistoryServiceName] = useState('');

  // Fetch settings from API
  const fetchSettings = async () => {
    try {
      const res = await fetch('/api/settings');
      if (res.ok) {
        const config = await res.json();
        setAutoCategory(config.autoCategory ?? true);
        setDefaultCurrency(config.defaultCurrency ?? 'KZT');
        setAutoMatchThreshold(config.autoMatchThreshold ?? 0.85);
        setManualReviewThreshold(config.manualReviewThreshold ?? 0.70);
        setUsdRate(config.usdRate ?? 450.0);
        setRubRate(config.rubRate ?? 5.0);
      }
    } catch (e) {
      console.error('Error fetching settings:', e);
    }
  };

  // Editing Modal States
  const [editingItem, setEditingItem] = useState<any>(null);
  const [editFormName, setEditFormName] = useState('');
  const [editFormResPrice, setEditFormResPrice] = useState<number | string>('');
  const [editFormNonresPrice, setEditFormNonresPrice] = useState<number | string>('');
  const [editFormCurrency, setEditFormCurrency] = useState('KZT');
  const [editFormServiceId, setEditFormServiceId] = useState<string | null>(null);
  const [editFormNote, setEditFormNote] = useState('');
  const [editFormVerified, setEditFormVerified] = useState(false);
  const [editFormSearch, setEditFormSearch] = useState('');
  const [editSubmitting, setEditSubmitting] = useState(false);

  // Undo history state
  const [undoHistory, setUndoHistory] = useState<{
    id: string;
    type: 'match' | 'verify' | 'edit';
    itemId: string;
    itemNameRaw: string;
    oldState: any;
    timestamp: string;
  }[]>([]);

  // Load undo history on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem('cleanpricer_undo_history');
      if (stored) {
        setUndoHistory(JSON.parse(stored));
      }
    } catch (e) {}
  }, []);

  const addUndoAction = (action: any) => {
    const updated = [action, ...undoHistory].slice(0, 10);
    setUndoHistory(updated);
    try {
      localStorage.setItem('cleanpricer_undo_history', JSON.stringify(updated));
    } catch (e) {}
  };

  const handleUndo = async (action: any) => {
    try {
      const res = await fetch('/api/edit-item', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          item_id: action.itemId,
          service_id: action.oldState.service_id,
          service_name_raw: action.oldState.service_name_raw,
          price_resident_kzt: action.oldState.price_resident_kzt,
          price_nonresident_kzt: action.oldState.price_nonresident_kzt,
          currency_original: action.oldState.currency_original,
          is_verified: action.oldState.is_verified,
          verification_note: action.oldState.verification_note
        }),
      });

      if (res.ok) {
        const typeRu = action.type === 'match' ? 'Сопоставление' : action.type === 'verify' ? 'Верификация' : 'Редактирование';
        showToast(`Действие "${typeRu}" отменено!`, 'success');
        const updated = undoHistory.filter(a => a.id !== action.id);
        setUndoHistory(updated);
        try {
          localStorage.setItem('cleanpricer_undo_history', JSON.stringify(updated));
        } catch (e) {}
        refreshAllData();
      } else {
        showToast('Ошибка при отмене действия', 'error');
      }
    } catch (e) {
      showToast('Сбой соединения при отмене', 'error');
    }
  };

  const startEditingItem = (item: any) => {
    setEditingItem(item);
    setEditFormName(item.service_name_raw || '');
    setEditFormResPrice(item.price_resident_kzt ?? '');
    setEditFormNonresPrice(item.price_nonresident_kzt ?? '');
    setEditFormCurrency(item.currency_original || 'KZT');
    setEditFormServiceId(item.service_id || null);
    setEditFormNote(item.verification_note || '');
    setEditFormVerified(item.is_verified ?? false);
    
    // Find the name of the service if matched
    const matchedService = services.find(s => s.service_id === item.service_id);
    setEditFormSearch(matchedService ? matchedService.service_name : '');
  };

  const handleEditSubmit = async () => {
    if (!editingItem) return;

    const originalState = {
      item_id: editingItem.item_id,
      service_id: editingItem.service_id,
      service_name_raw: editingItem.service_name_raw,
      price_resident_kzt: editingItem.price_resident_kzt,
      price_nonresident_kzt: editingItem.price_nonresident_kzt,
      currency_original: editingItem.currency_original,
      is_verified: editingItem.is_verified,
      verification_note: editingItem.verification_note
    };

    setEditSubmitting(true);
    try {
      const res = await fetch('/api/edit-item', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          item_id: editingItem.item_id,
          service_id: editFormServiceId,
          service_name_raw: editFormName,
          price_resident_kzt: editFormResPrice === '' ? null : Number(editFormResPrice),
          price_nonresident_kzt: editFormNonresPrice === '' ? null : Number(editFormNonresPrice),
          currency_original: editFormCurrency,
          is_verified: editFormVerified,
          verification_note: editFormNote || 'Отредактировано оператором'
        }),
      });

      if (res.ok) {
        showToast('Позиция успешно обновлена!', 'success');
        
        const action = {
          id: 'action-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5),
          type: 'edit' as const,
          itemId: editingItem.item_id,
          itemNameRaw: editingItem.service_name_raw,
          oldState: originalState,
          timestamp: new Date().toISOString()
        };
        addUndoAction(action);

        setEditingItem(null);
        refreshAllData();
      } else {
        showToast('Ошибка при обновлении позиции', 'error');
      }
    } catch (e) {
      showToast('Сбой соединения', 'error');
    } finally {
      setEditSubmitting(false);
    }
  };

  // Partner Add/Edit modal states
  const [partnerModalOpen, setPartnerModalOpen] = useState(false);
  const [editingPartner, setEditingPartner] = useState<any>(null);
  const [partnerFormName, setPartnerFormName] = useState('');
  const [partnerFormCity, setPartnerFormCity] = useState('');
  const [partnerFormAddress, setPartnerFormAddress] = useState('');
  const [partnerFormBin, setPartnerFormBin] = useState('');
  const [partnerFormEmail, setPartnerFormEmail] = useState('');
  const [partnerFormPhone, setPartnerFormPhone] = useState('');
  const [partnerFormActive, setPartnerFormActive] = useState(true);
  const [partnerSubmitting, setPartnerSubmitting] = useState(false);

  const startCreatingPartner = () => {
    setEditingPartner(null);
    setPartnerFormName('');
    setPartnerFormCity('');
    setPartnerFormAddress('');
    setPartnerFormBin('');
    setPartnerFormEmail('');
    setPartnerFormPhone('');
    setPartnerFormActive(true);
    setPartnerModalOpen(true);
  };

  const startEditingPartner = (partner: any) => {
    setEditingPartner(partner);
    setPartnerFormName(partner.name || '');
    setPartnerFormCity(partner.city || '');
    setPartnerFormAddress(partner.address || '');
    setPartnerFormBin(partner.bin || '');
    setPartnerFormEmail(partner.contact_email || '');
    setPartnerFormPhone(partner.contact_phone || '');
    setPartnerFormActive(partner.is_active ?? true);
    setPartnerModalOpen(true);
  };

  const handlePartnerSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!partnerFormName || !partnerFormCity) {
      showToast('Название и город обязательны', 'error');
      return;
    }

    setPartnerSubmitting(true);
    try {
      const isEdit = !!editingPartner;
      const url = '/api/partners';
      const method = isEdit ? 'PUT' : 'POST';
      const payload = {
        partner_id: isEdit ? editingPartner.partner_id : undefined,
        name: partnerFormName,
        city: partnerFormCity,
        address: partnerFormAddress,
        bin: partnerFormBin,
        contact_email: partnerFormEmail,
        contact_phone: partnerFormPhone,
        is_active: partnerFormActive,
      };

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        showToast(isEdit ? 'Данные партнера обновлены!' : 'Новый партнер добавлен!', 'success');
        setPartnerModalOpen(false);
        refreshAllData();
      } else {
        const data = await res.json();
        showToast(data.error || 'Ошибка сохранения', 'error');
      }
    } catch (err) {
      showToast('Сбой соединения', 'error');
    } finally {
      setPartnerSubmitting(false);
    }
  };

  const handleDeletePartner = async (partnerId: string) => {
    if (!confirm('Вы уверены, что хотите удалить/деактивировать этого партнера?')) return;

    try {
      const res = await fetch(`/api/partners?partner_id=${partnerId}`, {
        method: 'DELETE',
      });

      if (res.ok) {
        const data = await res.json();
        showToast(data.message || 'Партнер успешно удален', 'success');
        refreshAllData();
      } else {
        const data = await res.json();
        showToast(data.error || 'Ошибка удаления', 'error');
      }
    } catch (err) {
      showToast('Сбой соединения', 'error');
    }
  };

  // Service Catalog Add/Edit modal states
  const [serviceModalOpen, setServiceModalOpen] = useState(false);
  const [editingService, setEditingService] = useState<any>(null);
  const [serviceFormName, setServiceFormName] = useState('');
  const [serviceFormCategory, setServiceFormCategory] = useState('');
  const [serviceFormSynonyms, setServiceFormSynonyms] = useState('');
  const [serviceFormIcd, setServiceFormIcd] = useState('');
  const [serviceFormActive, setServiceFormActive] = useState(true);
  const [serviceSubmitting, setServiceSubmitting] = useState(false);

  const startCreatingService = () => {
    setEditingService(null);
    setServiceFormName('');
    setServiceFormCategory('');
    setServiceFormSynonyms('');
    setServiceFormIcd('');
    setServiceFormActive(true);
    setServiceModalOpen(true);
  };

  const startEditingService = (service: any) => {
    setEditingService(service);
    setServiceFormName(service.service_name || '');
    setServiceFormCategory(service.category || '');
    
    let synText = '';
    try {
      const synList = typeof service.synonyms === 'string' ? JSON.parse(service.synonyms) : (service.synonyms || []);
      synText = Array.isArray(synList) ? synList.join(', ') : '';
    } catch(e) {}
    
    setServiceFormSynonyms(synText);
    setServiceFormIcd(service.icd_code || '');
    setServiceFormActive(service.is_active ?? true);
    setServiceModalOpen(true);
  };

  const handleServiceSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!serviceFormName || !serviceFormCategory) {
      showToast('Название и категория обязательны', 'error');
      return;
    }

    setServiceSubmitting(true);
    try {
      const isEdit = !!editingService;
      const url = '/api/services';
      const method = isEdit ? 'PUT' : 'POST';
      const payload = {
        service_id: isEdit ? editingService.service_id : undefined,
        service_name: serviceFormName,
        category: serviceFormCategory,
        synonyms: serviceFormSynonyms,
        icd_code: serviceFormIcd,
        is_active: serviceFormActive,
      };

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        showToast(isEdit ? 'Данные услуги обновлены!' : 'Новая услуга добавлена!', 'success');
        setServiceModalOpen(false);
        refreshAllData();
      } else {
        const data = await res.json();
        showToast(data.error || 'Ошибка сохранения', 'error');
      }
    } catch (err) {
      showToast('Сбой соединения', 'error');
    } finally {
      setServiceSubmitting(false);
    }
  };

  const handleDeleteService = async (serviceId: string) => {
    if (!confirm('Вы уверены, что хотите удалить/деактивировать эту услугу?')) return;

    try {
      const res = await fetch(`/api/services?service_id=${serviceId}`, {
        method: 'DELETE',
      });

      if (res.ok) {
        const data = await res.json();
        showToast(data.message || 'Услуга успешно удалена', 'success');
        refreshAllData();
      } else {
        const data = await res.json();
        showToast(data.error || 'Ошибка удаления', 'error');
      }
    } catch (err) {
      showToast('Сбой соединения', 'error');
    }
  };

  const fetchAuthSession = async () => {
    try {
      const res = await fetch('/api/auth/session');
      if (res.ok) {
        setAuthState('authed');
        setAuthError('');
      } else {
        setAuthState('guest');
      }
    } catch (error: unknown) {
      setAuthState('guest');
    }
  };

  const handleLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    setAuthSubmitting(true);
    setAuthError('');

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: loginUsername,
          password: loginPassword,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setAuthError(data.error || 'Не удалось войти');
        setAuthState('guest');
        return;
      }

      await res.json();
      setLoginPassword('');
      setAuthState('authed');
    } catch (error: unknown) {
      setAuthError('Сбой соединения');
      setAuthState('guest');
    } finally {
      setAuthSubmitting(false);
    }
  };

  // Save settings via API
  const handleSaveSettings = async (updates: SettingsUpdate) => {
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (res.ok) {
        showToast('Настройки сохранены!', 'success');
        const data = await res.json();
        setAutoCategory(data.config.autoCategory);
        setDefaultCurrency(data.config.defaultCurrency);
        setAutoMatchThreshold(data.config.autoMatchThreshold);
        setManualReviewThreshold(data.config.manualReviewThreshold);
        setUsdRate(data.config.usdRate);
        setRubRate(data.config.rubRate);
      } else {
        showToast('Ошибка сохранения настроек', 'error');
      }
    } catch (e) {
      showToast('Сбой соединения', 'error');
    }
  };

  // Fetch partner prices history
  const handleViewHistory = async (clinic: ExplorerClinicResult) => {
    setHistoryPartnerName(clinic.partner_name);
    setHistoryServiceName(selectedExplorerService?.service_name || '');
    try {
      const res = await fetch(`/api/history?service_id=${selectedExplorerService?.service_id}&partner_id=${clinic.partner_id}`);
      if (res.ok) {
        const data = await res.json();
        setHistoryItems(data);
        setHistoryModalOpen(true);
      } else {
        showToast('Не удалось загрузить историю цен', 'error');
      }
    } catch (e) {
      showToast('Ошибка сети', 'error');
    }
  };

  // Trigger Toast Notification
  const showToast = (message: string, type: 'success' | 'info' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  // Fetch Dashboard Stats
  const fetchDashboardStats = async () => {
    try {
      const res = await fetch('/api/dashboard');
      if (res.ok) {
        const data = await res.json();
        setStats(data);
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Fetch Documents
  const fetchDocuments = async () => {
    try {
      const res = await fetch('/api/get-items');
      if (res.ok) {
        const data = await res.json();
        setDocuments(data);
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Fetch Catalog Services
  const fetchCatalogServices = async () => {
    try {
      const res = await fetch('/api/services?include_inactive=true');
      if (res.ok) {
        const data = await res.json();
        setServices(data);
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Fetch Clinic Partners
  const fetchClinicPartners = async () => {
    try {
      const res = await fetch('/api/partners');
      if (res.ok) {
        const data = await res.json();
        setPartners(data);
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Fetch Unmatched Queue
  const fetchUnmatchedItems = async () => {
    try {
      const res = await fetch('/api/unmatched');
      if (res.ok) {
        const data = await res.json();
        setUnmatchedItems(data);
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Load All Dashboard Data
  const refreshAllData = async () => {
    if (authState !== 'authed') {
      return;
    }

    await fetchDashboardStats();
    await fetchDocuments();
    await fetchCatalogServices();
    await fetchClinicPartners();
    await fetchUnmatchedItems();
    await fetchSettings();
    try {
      const res = await fetch('/api/unverified');
      if (res.ok) {
        const data = await res.json();
        setVerifiedItems(data);
      }
    } catch (e) {
      // Fallback
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchAuthSession();
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (authState === 'authed') {
      const timer = window.setTimeout(() => {
        void refreshAllData();
      }, 0);
      return () => window.clearTimeout(timer);
    }
  }, [authState]);

  // Poll for document processing updates
  useEffect(() => {
    if (authState !== 'authed') {
      return;
    }

    const isProcessing = documents.some(
      (d) => d.parse_status === 'pending' || d.parse_status === 'processing'
    );
    if (!isProcessing) return;

    const interval = setInterval(() => {
      fetchDocuments();
      fetchDashboardStats();
      fetchUnmatchedItems();
    }, 3000);

    return () => clearInterval(interval);
  }, [documents, authState]);

  // Handle Price List / ZIP Archive Upload
  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.[0]) return;
    const file = e.target.files[0];
    
    setUploading(true);
    setUploadProgress(20);
    setUploadMessage('Загрузка файла на сервер...');

    const formData = new FormData();
    formData.append('file', file);

    try {
      setUploadProgress(50);
      setUploadMessage('Архив загружен, распаковка и постановка в очередь...');
      
      const res = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });

      setUploadProgress(90);
      
      if (res.ok) {
        const data = await res.json();
        showToast(data.message || 'Файл успешно добавлен в очередь!', 'success');
        setUploadProgress(100);
        setTimeout(() => {
          setUploading(false);
          refreshAllData();
          setActiveTab('dashboard');
        }, 500);
      } else {
        const errData = await res.json();
        showToast(errData.error || 'Ошибка при загрузке файла', 'error');
        setUploading(false);
      }
    } catch (error: unknown) {
      console.error(error);
      showToast('Сбой сети при загрузке', 'error');
      setUploading(false);
    }
  };

  // Handle Catalog Seeding Upload
  const handleCatalogUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.[0]) return;
    const file = e.target.files[0];

    setCatalogFileUploading(true);
    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch('/api/upload-catalog', {
        method: 'POST',
        body: formData,
      });

      if (res.ok) {
        const data = await res.json();
        showToast(data.message || 'Справочник успешно загружен!', 'success');
        refreshAllData();
      } else {
        const errData = await res.json();
        showToast(errData.error || 'Ошибка при загрузке справочника', 'error');
      }
    } catch (e) {
      showToast('Ошибка сети при загрузке справочника', 'error');
    } finally {
      setCatalogFileUploading(false);
    }
  };

  // Handle Manual Service Match Submission
  const handleManualMatchSubmit = async (serviceId: string) => {
    if (!selectedUnmatchedItem) return;

    const originalState = {
      item_id: selectedUnmatchedItem.item_id,
      service_id: selectedUnmatchedItem.service_id,
      service_name_raw: selectedUnmatchedItem.service_name_raw,
      price_resident_kzt: selectedUnmatchedItem.price_resident_kzt,
      price_nonresident_kzt: selectedUnmatchedItem.price_nonresident_kzt,
      currency_original: selectedUnmatchedItem.currency_original,
      is_verified: selectedUnmatchedItem.is_verified,
      verification_note: selectedUnmatchedItem.verification_note
    };

    try {
      const res = await fetch('/api/match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          item_id: selectedUnmatchedItem.item_id,
          service_id: serviceId,
          verification_note: mappingNote || 'Сопоставлено вручную оператором'
        }),
      });

      if (res.ok) {
        showToast('Позиция успешно сопоставлена!', 'success');

        const action = {
          id: 'action-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5),
          type: 'match' as const,
          itemId: selectedUnmatchedItem.item_id,
          itemNameRaw: selectedUnmatchedItem.service_name_raw,
          oldState: originalState,
          timestamp: new Date().toISOString()
        };
        addUndoAction(action);

        setSelectedUnmatchedItem(null);
        setMappingSearch('');
        setMappingNote('');
        refreshAllData();
      } else {
        showToast('Ошибка при сохранении сопоставления', 'error');
      }
    } catch (e) {
      showToast('Сбой соединения', 'error');
    }
  };

  // Trigger search on price explorer
  const handleExplorerSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!explorerQuery.trim()) return;

    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(explorerQuery)}`);
      if (res.ok) {
        const data = await res.json();
        setExplorerResults(data);
        setSelectedExplorerService(null);
        setExplorerServiceClinics([]);
      }
    } catch (e) {
      showToast('Ошибка поиска', 'error');
    }
  };

  // Fetch partner prices for a selected catalog service
  const handleSelectExplorerService = async (service: CatalogService) => {
    setSelectedExplorerService(service);
    try {
      const res = await fetch(`/api/services/${service.service_id}/partners`);
      if (res.ok) {
        const data = await res.json();
        setExplorerServiceClinics(data);
      }
    } catch (e) {
      showToast('Не удалось загрузить цены партнеров', 'error');
    }
  };

  // Filtered lists for simple clientside searches
  const filteredCatalog = services.filter((s) => {
    const matchesSearch = s.service_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (s.icd_code && s.icd_code.toLowerCase().includes(searchQuery.toLowerCase()));
    const matchesCat = categoryFilter === 'ALL' ? true : s.category === categoryFilter;
    return matchesSearch && matchesCat;
  });

  const filteredPartners = partners.filter((p) => {
    if (categoryFilter === 'ALL') return true;
    return p.city && p.city.toLowerCase() === categoryFilter.toLowerCase();
  });

  // Extract unique categories from catalog for dropdowns
  const categoriesList = Array.from(new Set(services.map((s) => s.category))).filter(Boolean);
  const citiesList = Array.from(new Set(partners.map((p) => p.city))).filter(Boolean);

  if (authState !== 'authed') {
    return (
      <div className="min-h-screen w-full bg-slate-950 text-white flex items-center justify-center px-4">
        <div className="w-full max-w-md border border-white/10 bg-slate-900/90 rounded-3xl p-8 shadow-2xl">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-12 h-12 rounded-2xl bg-indigo-500/15 border border-indigo-400/20 flex items-center justify-center">
              <Shield className="w-6 h-6 text-indigo-300" />
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-[0.2em] text-slate-400">MedPartners</p>
              <h1 className="text-2xl font-bold text-white">Вход в систему</h1>
            </div>
          </div>

          {authState === 'loading' ? (
            <div className="py-10 flex flex-col items-center gap-3 text-slate-300">
              <div className="w-10 h-10 rounded-full border-2 border-slate-700 border-t-indigo-400 animate-spin" />
              <p className="text-sm">Проверяем сессию</p>
            </div>
          ) : (
            <form onSubmit={handleLogin} className="space-y-4">
              <label className="block">
                <span className="block text-xs font-semibold text-slate-300 mb-2">Логин</span>
                <input
                  value={loginUsername}
                  onChange={(e) => setLoginUsername(e.target.value)}
                  autoComplete="username"
                  className="w-full h-11 rounded-xl bg-slate-950 border border-slate-700 px-3 text-sm text-white outline-none focus:border-indigo-400"
                />
              </label>

              <label className="block">
                <span className="block text-xs font-semibold text-slate-300 mb-2">Пароль</span>
                <input
                  type="password"
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  autoComplete="current-password"
                  className="w-full h-11 rounded-xl bg-slate-950 border border-slate-700 px-3 text-sm text-white outline-none focus:border-indigo-400"
                />
              </label>

              {authError && (
                <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
                  {authError}
                </div>
              )}

              <button
                type="submit"
                disabled={authSubmitting}
                className="w-full h-11 rounded-xl bg-indigo-500 text-white font-semibold flex items-center justify-center gap-2 hover:bg-indigo-400 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {authSubmitting ? (
                  <span className="w-4 h-4 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                ) : (
                  <LogIn className="w-4 h-4" />
                )}
                <span>{authSubmitting ? 'Входим...' : 'Войти'}</span>
              </button>

              <div className="flex items-center gap-2 text-[11px] text-slate-400 pt-2">
                <LockKeyhole className="w-3.5 h-3.5" />
                <span>После входа откроется административный раздел и API-запросы.</span>
              </div>
            </form>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen bg-[#f8fafc] text-[#1e293b] font-sans antialiased overflow-hidden flex p-4" id="medpartners-layout">
      {/* Toast Notification */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: -40, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.95 }}
            className={`fixed top-6 right-6 z-50 flex items-center gap-3 px-4 py-3 rounded-xl shadow-[0_12px_32px_rgba(15,23,42,0.15)] border text-xs font-semibold ${
              toast.type === 'success'
                ? 'bg-emerald-950 text-emerald-300 border-emerald-800'
                : toast.type === 'error'
                ? 'bg-rose-950 text-rose-300 border-rose-800'
                : 'bg-slate-900 text-white border-slate-800'
            }`}
          >
            {toast.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            ) : toast.type === 'error' ? (
              <AlertTriangle className="w-4 h-4 text-rose-400" />
            ) : (
              <Info className="w-4 h-4 text-blue-400" />
            )}
            <span>{toast.message}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Price History Modal */}
      {historyModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl p-6 max-w-lg w-full border border-slate-150 shadow-2xl flex flex-col max-h-[500px]">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 flex-shrink-0">
              <div>
                <h3 className="font-bold text-slate-800 text-sm">История изменения цен</h3>
                <p className="text-[11px] text-slate-400 mt-0.5">{historyPartnerName} — {historyServiceName}</p>
              </div>
              <button
                onClick={() => setHistoryModalOpen(false)}
                className="w-7 h-7 bg-slate-100 text-slate-500 rounded-lg flex items-center justify-center hover:bg-slate-200 cursor-pointer transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar my-4 border border-slate-150 rounded-xl bg-slate-50/50">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500 font-semibold bg-slate-100 h-9 sticky top-0">
                    <th className="px-3">Дата прайса</th>
                    <th className="px-3">Резидент</th>
                    <th className="px-3">Нерезидент</th>
                    <th className="px-3">Документ</th>
                    <th className="px-3 text-center">Статус</th>
                  </tr>
                </thead>
                <tbody>
                  {historyItems.map((item, idx) => (
                    <tr key={idx} className={`border-b border-slate-100 h-9 hover:bg-slate-50/80 ${item.is_active ? 'bg-indigo-50/20 font-semibold text-indigo-900' : 'text-slate-500'}`}>
                      <td className="px-3">{new Date(item.effective_date).toLocaleDateString()}</td>
                      <td className="px-3">{item.price_resident_kzt} KZT</td>
                      <td className="px-3">{item.price_nonresident_kzt} {item.currency_original || 'KZT'}</td>
                      <td className="px-3 truncate max-w-[120px]" title={item.file_name}>{item.file_name}</td>
                      <td className="px-3 text-center">
                        <span className={`px-1.5 py-0.5 rounded text-[9px] ${item.is_active ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-slate-100 text-slate-400'}`}>
                          {item.is_active ? 'Активен' : 'Архив'}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {historyItems.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-slate-400">
                        Исторические записи не найдены
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end flex-shrink-0 pt-2 border-t border-slate-100">
              <button
                onClick={() => setHistoryModalOpen(false)}
                className="h-9 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs cursor-pointer transition"
              >
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Price Item Modal */}
      {editingItem && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl p-6 max-w-xl w-full border border-slate-150 shadow-2xl flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 flex-shrink-0">
              <div>
                <h3 className="font-bold text-slate-800 text-sm">Редактирование позиции прайса</h3>
                <p className="text-[11px] text-slate-400 mt-0.5">ID: {editingItem.item_id}</p>
              </div>
              <button
                onClick={() => setEditingItem(null)}
                className="w-7 h-7 bg-slate-100 text-slate-500 rounded-lg flex items-center justify-center hover:bg-slate-200 cursor-pointer transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar my-4 pr-1 flex flex-col gap-4 text-xs">
              <div className="flex flex-col gap-1">
                <label className="font-semibold text-slate-700">Исходное наименование:</label>
                <input
                  type="text"
                  value={editFormName}
                  onChange={(e) => setEditFormName(e.target.value)}
                  className="w-full h-10 px-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-1">
                  <label className="font-semibold text-slate-700">Цена для резидентов (KZT):</label>
                  <input
                    type="number"
                    value={editFormResPrice}
                    onChange={(e) => setEditFormResPrice(e.target.value)}
                    className="w-full h-10 px-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-indigo-500 font-bold"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="font-semibold text-slate-700">Цена для нерезидентов:</label>
                  <input
                    type="number"
                    value={editFormNonresPrice}
                    onChange={(e) => setEditFormNonresPrice(e.target.value)}
                    className="w-full h-10 px-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-indigo-500 font-bold"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-1">
                  <label className="font-semibold text-slate-700">Оригинальная валюта:</label>
                  <select
                    value={editFormCurrency}
                    onChange={(e) => setEditFormCurrency(e.target.value)}
                    className="w-full h-10 px-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer"
                  >
                    <option value="KZT">KZT</option>
                    <option value="USD">USD</option>
                    <option value="RUB">RUB</option>
                  </select>
                </div>
                <div className="flex items-center gap-2 pt-6">
                  <input
                    type="checkbox"
                    id="editFormVerified"
                    checked={editFormVerified}
                    onChange={(e) => setEditFormVerified(e.target.checked)}
                    className="w-4 h-4 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500 cursor-pointer"
                  />
                  <label htmlFor="editFormVerified" className="font-semibold text-slate-700 cursor-pointer select-none">
                    Позиция верифицирована
                  </label>
                </div>
              </div>

              {/* Catalog Matching Search */}
              <div className="flex flex-col gap-1 border-t border-slate-100 pt-3">
                <div className="flex items-center justify-between">
                  <label className="font-semibold text-slate-700">Сопоставить со справочником:</label>
                  {editFormServiceId && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditFormServiceId(null);
                        setEditFormSearch('');
                      }}
                      className="text-[10px] text-rose-600 hover:text-rose-800 font-semibold"
                    >
                      Очистить сопоставление
                    </button>
                  )}
                </div>
                <div className="relative">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                  <input
                    type="text"
                    value={editFormSearch}
                    onChange={(e) => {
                      setEditFormSearch(e.target.value);
                    }}
                    placeholder="Поиск в каталоге услуг..."
                    className="w-full h-10 pl-9 pr-4 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
                
                {/* Autocomplete list */}
                {editFormSearch.trim() !== '' && (
                  <div className="mt-1 max-h-[140px] overflow-y-auto border border-slate-150 rounded-xl divide-y divide-slate-100 custom-scrollbar bg-slate-50">
                    {services
                      .filter((s) => s.service_name.toLowerCase().includes(editFormSearch.toLowerCase()))
                      .slice(0, 5)
                      .map((s, idx) => (
                        <button
                          type="button"
                          key={idx}
                          onClick={() => {
                            setEditFormServiceId(s.service_id);
                            setEditFormSearch(s.service_name);
                          }}
                          className="w-full text-left p-2.5 hover:bg-indigo-50/50 flex items-center justify-between text-[11px] transition cursor-pointer"
                        >
                          <div>
                            <p className="font-semibold text-slate-800">{s.service_name}</p>
                            <span className="text-[9px] text-slate-400 bg-slate-150 px-1 py-0.2 rounded mt-0.5 inline-block">
                              {s.category}
                            </span>
                          </div>
                          {editFormServiceId === s.service_id && (
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                          )}
                        </button>
                      ))}
                    {services.filter((s) => s.service_name.toLowerCase().includes(editFormSearch.toLowerCase())).length === 0 && (
                      <div className="p-3 text-center text-slate-400">Ничего не найдено</div>
                    )}
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-1 border-t border-slate-100 pt-3">
                <label className="font-semibold text-slate-700">Примечание к верификации:</label>
                <textarea
                  value={editFormNote}
                  onChange={(e) => setEditFormNote(e.target.value)}
                  placeholder="Причина предупреждения или комментарий ручной обработки..."
                  className="w-full h-16 p-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-indigo-500 resize-none"
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 flex-shrink-0 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setEditingItem(null)}
                className="h-10 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs cursor-pointer transition"
              >
                Отмена
              </button>
              <button
                type="button"
                disabled={editSubmitting}
                onClick={handleEditSubmit}
                className="h-10 px-5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white font-bold rounded-xl text-xs cursor-pointer transition flex items-center gap-1.5"
              >
                {editSubmitting ? 'Сохранение...' : 'Сохранить изменения'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Partner Add/Edit Modal */}
      {partnerModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <form onSubmit={handlePartnerSubmit} className="bg-white rounded-3xl p-6 max-w-md w-full border border-slate-150 shadow-2xl flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 flex-shrink-0">
              <div>
                <h3 className="font-bold text-slate-800 text-sm">
                  {editingPartner ? 'Редактировать партнера' : 'Добавить нового партнера'}
                </h3>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  {editingPartner ? `ID: ${editingPartner.partner_id.substring(0, 8)}...` : 'Заполните информацию о клинике'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPartnerModalOpen(false)}
                className="w-7 h-7 bg-slate-100 text-slate-500 rounded-lg flex items-center justify-center hover:bg-slate-200 cursor-pointer transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar my-4 pr-1 flex flex-col gap-4 text-xs">
              <div className="flex flex-col gap-1">
                <label className="font-semibold text-slate-700">Название клиники/партнера *:</label>
                <input
                  type="text"
                  required
                  value={partnerFormName}
                  onChange={(e) => setPartnerFormName(e.target.value)}
                  placeholder="Например, Medical Center Almaty"
                  className="w-full h-10 px-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-1">
                  <label className="font-semibold text-slate-700">Город *:</label>
                  <input
                    type="text"
                    required
                    value={partnerFormCity}
                    onChange={(e) => setPartnerFormCity(e.target.value)}
                    placeholder="Например, Алматы"
                    className="w-full h-10 px-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="font-semibold text-slate-700">БИН:</label>
                  <input
                    type="text"
                    value={partnerFormBin}
                    onChange={(e) => setPartnerFormBin(e.target.value)}
                    placeholder="12-значный номер"
                    maxLength={12}
                    className="w-full h-10 px-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <label className="font-semibold text-slate-700">Фактический адрес:</label>
                <input
                  type="text"
                  value={partnerFormAddress}
                  onChange={(e) => setPartnerFormAddress(e.target.value)}
                  placeholder="Улица, дом, офис"
                  className="w-full h-10 px-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-1">
                  <label className="font-semibold text-slate-700">Контактный Email:</label>
                  <input
                    type="email"
                    value={partnerFormEmail}
                    onChange={(e) => setPartnerFormEmail(e.target.value)}
                    placeholder="partner@example.com"
                    className="w-full h-10 px-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="font-semibold text-slate-700">Телефон:</label>
                  <input
                    type="text"
                    value={partnerFormPhone}
                    onChange={(e) => setPartnerFormPhone(e.target.value)}
                    placeholder="+7 (707) 123-4567"
                    className="w-full h-10 px-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2 pt-2 border-t border-slate-100 mt-2">
                <input
                  type="checkbox"
                  id="partnerFormActive"
                  checked={partnerFormActive}
                  onChange={(e) => setPartnerFormActive(e.target.checked)}
                  className="w-4 h-4 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500 cursor-pointer"
                />
                <label htmlFor="partnerFormActive" className="font-semibold text-slate-700 cursor-pointer select-none">
                  Клиника активна (разрешить сопоставление и импорт прайсов)
                </label>
              </div>
            </div>

            <div className="flex justify-end gap-3 flex-shrink-0 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setPartnerModalOpen(false)}
                className="h-10 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs cursor-pointer transition"
              >
                Отмена
              </button>
              <button
                type="submit"
                disabled={partnerSubmitting}
                className="h-10 px-5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white font-bold rounded-xl text-xs cursor-pointer transition flex items-center gap-1.5"
              >
                {partnerSubmitting ? 'Сохранение...' : editingPartner ? 'Сохранить' : 'Добавить'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Service Catalog Add/Edit Modal */}
      {serviceModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <form onSubmit={handleServiceSubmit} className="bg-white rounded-3xl p-6 max-w-md w-full border border-slate-150 shadow-2xl flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 flex-shrink-0">
              <div>
                <h3 className="font-bold text-slate-800 text-sm">
                  {editingService ? 'Редактировать услугу справочника' : 'Добавить новую услугу в справочник'}
                </h3>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  {editingService ? `ID: ${editingService.service_id.substring(0, 8)}...` : 'Создайте новую целевую медицинскую услугу'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setServiceModalOpen(false)}
                className="w-7 h-7 bg-slate-100 text-slate-500 rounded-lg flex items-center justify-center hover:bg-slate-200 cursor-pointer transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar my-4 pr-1 flex flex-col gap-4 text-xs">
              <div className="flex flex-col gap-1">
                <label className="font-semibold text-slate-700">Официальное наименование услуги *:</label>
                <input
                  type="text"
                  required
                  value={serviceFormName}
                  onChange={(e) => setServiceFormName(e.target.value)}
                  placeholder="Например, Общий анализ крови (ОАК)"
                  className="w-full h-10 px-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-1">
                  <label className="font-semibold text-slate-700">Категория *:</label>
                  <input
                    type="text"
                    required
                    value={serviceFormCategory}
                    onChange={(e) => setServiceFormCategory(e.target.value)}
                    placeholder="Например, Лаборатория"
                    className="w-full h-10 px-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="font-semibold text-slate-700">Код МКБ:</label>
                  <input
                    type="text"
                    value={serviceFormIcd}
                    onChange={(e) => setServiceFormIcd(e.target.value)}
                    placeholder="Например, A09.0"
                    className="w-full h-10 px-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-indigo-500 font-mono"
                  />
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <label className="font-semibold text-slate-700">Синонимы (через запятую):</label>
                <textarea
                  value={serviceFormSynonyms}
                  onChange={(e) => setServiceFormSynonyms(e.target.value)}
                  placeholder="ОАК, клинический анализ крови, анализ крови с лейкоформулой"
                  className="w-full h-16 p-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-indigo-500 resize-none"
                />
                <span className="text-[10px] text-slate-400">Используются алгоритмом разметки для автоматического сопоставления.</span>
              </div>

              <div className="flex items-center gap-2 pt-2 border-t border-slate-100 mt-2">
                <input
                  type="checkbox"
                  id="serviceFormActive"
                  checked={serviceFormActive}
                  onChange={(e) => setServiceFormActive(e.target.checked)}
                  className="w-4 h-4 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500 cursor-pointer"
                />
                <label htmlFor="serviceFormActive" className="font-semibold text-slate-700 cursor-pointer select-none">
                  Услуга активна (отображать в поиске и справочниках)
                </label>
              </div>
            </div>

            <div className="flex justify-end gap-3 flex-shrink-0 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setServiceModalOpen(false)}
                className="h-10 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs cursor-pointer transition"
              >
                Отмена
              </button>
              <button
                type="submit"
                disabled={serviceSubmitting}
                className="h-10 px-5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white font-bold rounded-xl text-xs cursor-pointer transition flex items-center gap-1.5"
              >
                {serviceSubmitting ? 'Сохранение...' : editingService ? 'Сохранить' : 'Добавить'}
              </button>
            </div>
          </form>
        </div>
      )}


      {/* COLLAPSIBLE SIDEBAR */}
      <aside
        className={`h-full bg-gradient-to-b from-[#4f46e5] to-[#3730a3] rounded-3xl py-6 px-4 flex flex-col justify-between transition-all duration-300 ease-in-out z-30 select-none flex-shrink-0 border border-white/10 ${
          isSidebarExpanded ? 'w-[240px] shadow-[12px_0_36px_rgba(79,70,229,0.15)]' : 'w-20'
        }`}
      >
        <div className="flex flex-col gap-6 flex-shrink-0">
          <div className="flex items-center justify-between w-full h-12">
            <div className="flex items-center gap-2 overflow-hidden">
              <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center flex-shrink-0 shadow-md">
                <Sparkles className="w-5 h-5 text-[#4f46e5] stroke-[2.5]" />
              </div>
              {isSidebarExpanded && (
                <span className="font-extrabold text-white text-lg tracking-tight truncate">
                  MedPartners
                </span>
              )}
            </div>
            <button
              onClick={() => setIsSidebarExpanded(!isSidebarExpanded)}
              className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-all duration-200 cursor-pointer border border-white/10 shadow-sm"
            >
              <ChevronLeft className={`w-5 h-5 transition-transform duration-300 ${!isSidebarExpanded ? 'rotate-180' : ''}`} />
            </button>
          </div>
        </div>

        {/* Navigation list */}
        <nav className="flex flex-col gap-4 py-4 overflow-y-auto flex-1 custom-scrollbar">
          {(() => {
            const navGroups = [
              {
                title: 'Администратор',
                items: [
                  { id: 'dashboard', label: 'Аналитика системы', icon: LayoutDashboard },
                  { id: 'archive_processing', label: 'Загрузка прайсов', icon: Archive },
                  { id: 'price_documents', label: 'Реестр документов', icon: FileText },
                ]
              },
              {
                title: 'Оператор',
                items: [
                  { id: 'verification_queue', label: 'Очередь верификации', icon: ListChecks },
                  { id: 'unmatched_services', label: 'Несопоставленные', icon: ZapOff },
                ]
              },
              {
                title: 'Справочники и настройки',
                items: [
                  { id: 'service_catalog', label: 'Справочник услуг', icon: BookOpen },
                  { id: 'partners', label: 'Партнеры (Клиники)', icon: Users },
                  { id: 'price_explorer', label: 'Поиск цен', icon: Search },
                  { id: 'api_center', label: 'Интеграция API', icon: Cpu },
                  { id: 'settings', label: 'Настройки системы', icon: Settings },
                ]
              }
            ];
            return navGroups.map((group, gIdx) => (
              <div key={gIdx} className="flex flex-col gap-1">
                {isSidebarExpanded && (
                  <span className="text-[10px] uppercase font-bold text-white/50 px-3.5 mb-1.5 tracking-wider">
                    {group.title}
                  </span>
                )}
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const isActive = activeTab === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => setActiveTab(item.id as ActiveTab)}
                      className={`w-full h-10 rounded-xl flex items-center transition-all duration-150 cursor-pointer ${
                        isSidebarExpanded ? 'px-3.5 gap-3' : 'justify-center'
                      } ${
                        isActive
                          ? 'bg-white text-[#4f46e5] shadow-md font-semibold'
                          : 'text-white/85 hover:bg-white/10 hover:text-white'
                      }`}
                    >
                      <Icon className="w-4.5 h-4.5 flex-shrink-0" strokeWidth={2} />
                      {isSidebarExpanded && <span className="text-[12px] truncate">{item.label}</span>}
                    </button>
                  );
                })}
              </div>
            ));
          })()}
        </nav>

        {/* Footer info */}
        {isSidebarExpanded && (
          <div className="bg-white/10 border border-white/10 rounded-2xl p-3 text-white/80 text-[11px] flex items-center gap-2">
            <Database className="w-4 h-4 text-white flex-shrink-0" />
            <div className="truncate">
              <p className="font-semibold text-white">База данных</p>
              <p className="opacity-75">Подключено к PostgreSQL</p>
            </div>
          </div>
        )}
      </aside>

      {/* MAIN VIEW AREA */}
      <main className="flex-1 h-full overflow-hidden flex flex-col pl-4 md:pl-6">
        
        {/* TOP STATUS BAR */}
        <header className="h-16 flex items-center justify-between border-b border-slate-200/60 pb-3 flex-shrink-0">
          <div>
            <h1 className="text-xl font-bold text-slate-800">
              {activeTab === 'dashboard' && 'Медицинский процессор прайс-листов'}
              {activeTab === 'archive_processing' && 'Обработка архивов'}
              {activeTab === 'price_documents' && 'Реестр документов прайсов'}
              {activeTab === 'verification_queue' && 'Очередь ручной верификации'}
              {activeTab === 'unmatched_services' && 'Разметка несопоставленных услуг'}
              {activeTab === 'service_catalog' && 'Целевой справочник медицинских услуг'}
              {activeTab === 'partners' && 'Клиники-партнеры'}
              {activeTab === 'price_explorer' && 'Поисковый модуль цен'}
              {activeTab === 'api_center' && 'Справочник API / Документация'}
              {activeTab === 'settings' && 'Настройки'}
            </h1>
            <p className="text-xs text-slate-500">Система автоматического разбора и нормализации цен MedPartners</p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={refreshAllData}
              className="h-10 px-3 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-600 flex items-center gap-2 hover:bg-slate-50 hover:text-slate-800 transition-all cursor-pointer shadow-sm"
              title="Обновить данные"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Синхронизировать</span>
            </button>
            <div className="h-10 px-3 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-sm">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              <span>Система Активна</span>
            </div>
          </div>
        </header>

        {/* TAB CONTENTS */}
        <div className="flex-1 overflow-hidden py-4">
          
          {/* TAB 1: DASHBOARD OVERVIEW */}
          {activeTab === 'dashboard' && (
            <div className="h-full overflow-y-auto custom-scrollbar flex flex-col gap-6 pr-2">
              
              {/* KPIs Grid */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                
                <div className="bg-white border border-slate-200 p-5 rounded-2xl shadow-sm flex items-center justify-between">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Всего позиций в базе</p>
                    <p className="text-2xl font-bold text-slate-800 mt-1">{stats.total_items}</p>
                    <p className="text-[10px] text-slate-400 mt-1">Активные нормализованные цены</p>
                  </div>
                  <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center shadow-inner">
                    <Database className="w-6 h-6" />
                  </div>
                </div>

                <div className="bg-white border border-slate-200 p-5 rounded-2xl shadow-sm flex items-center justify-between">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Точность автосопоставления</p>
                    <p className="text-2xl font-bold text-emerald-600 mt-1">{stats.normalization_rate}%</p>
                    <p className="text-[10px] text-slate-400 mt-1">Уверенное автосвязывание (&gt;85%)</p>
                  </div>
                  <div className="w-12 h-12 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center shadow-inner">
                    <TrendingUp className="w-6 h-6" />
                  </div>
                </div>

                <div className="bg-white border border-slate-200 p-5 rounded-2xl shadow-sm flex items-center justify-between">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Очередь верификации</p>
                    <p className="text-2xl font-bold text-amber-600 mt-1">{stats.unverified_items}</p>
                    <p className="text-[10px] text-slate-400 mt-1">Требуют ревью или подтверждения</p>
                  </div>
                  <div className="w-12 h-12 bg-amber-50 text-amber-600 rounded-2xl flex items-center justify-center shadow-inner">
                    <ListChecks className="w-6 h-6" />
                  </div>
                </div>

                <div className="bg-white border border-slate-200 p-5 rounded-2xl shadow-sm flex items-center justify-between">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Несопоставленные услуги</p>
                    <p className="text-2xl font-bold text-rose-600 mt-1">{stats.unmatched_items}</p>
                    <p className="text-[10px] text-slate-400 mt-1">Не связаны с официальным справочником</p>
                  </div>
                  <div className="w-12 h-12 bg-rose-50 text-rose-600 rounded-2xl flex items-center justify-center shadow-inner">
                    <ZapOff className="w-6 h-6" />
                  </div>
                </div>

              </div>

              {/* Grid 2 Columns */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                
                {/* File Upload Section */}
                <div className="lg:col-span-1 bg-white border border-slate-200 rounded-2xl p-5 shadow-sm flex flex-col justify-between min-h-[300px]">
                  <div>
                    <h3 className="font-bold text-slate-800 text-sm">Загрузить прайс-лист</h3>
                    <p className="text-xs text-slate-500 mt-1">Загрузите XLS, XLSX, PDF (включая сканы) или архив ZIP</p>
                  </div>

                  {!uploading ? (
                    <label className="border-2 border-dashed border-slate-200 hover:border-indigo-400 bg-slate-50/50 hover:bg-slate-50 rounded-2xl p-6 flex flex-col items-center justify-center cursor-pointer transition-all my-4 flex-1 min-h-[140px]">
                      <UploadCloud className="w-10 h-10 text-indigo-500 animate-bounce" />
                      <span className="text-xs font-semibold text-slate-700 mt-3">Нажмите для выбора файла</span>
                      <span className="text-[10px] text-slate-400 mt-1">XLSX, XLS, PDF, DOCX, ZIP (Макс. 50MB)</span>
                      <input type="file" onChange={handleUpload} className="hidden" accept=".zip,.xlsx,.xls,.docx,.pdf" />
                    </label>
                  ) : (
                    <div className="border border-slate-100 bg-slate-50 rounded-2xl p-6 flex flex-col items-center justify-center my-4 flex-1">
                      <RefreshCw className="w-8 h-8 text-indigo-600 animate-spin" />
                      <span className="text-xs font-bold text-slate-700 mt-3">{uploadMessage}</span>
                      
                      <div className="w-full bg-slate-200 h-1.5 rounded-full overflow-hidden mt-3 max-w-[200px]">
                        <div className="bg-indigo-600 h-full rounded-full transition-all duration-300" style={{ width: `${uploadProgress}%` }}></div>
                      </div>
                    </div>
                  )}

                  <div className="bg-slate-50 rounded-xl p-3 border border-slate-150 text-[10px] text-slate-500">
                    <div className="flex items-center gap-1.5 text-indigo-700 font-bold">
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>ИИ-Парсинг документов</span>
                    </div>
                    <p className="mt-1">Система автоматически распознает клинику, резидентов/нерезидентов, валюты и сопоставит услуги со справочником в фоновом режиме.</p>
                  </div>
                </div>

                {/* Recent Documents Table */}
                <div className="lg:col-span-2 bg-white border border-slate-200 rounded-2xl p-5 shadow-sm flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between">
                      <h3 className="font-bold text-slate-800 text-sm">Последние обработанные документы</h3>
                      <button onClick={() => setActiveTab('price_documents')} className="text-xs text-indigo-600 hover:text-indigo-800 font-bold flex items-center gap-0.5 cursor-pointer">
                        <span>Все документы</span>
                        <ArrowRight className="w-3 h-3" />
                      </button>
                    </div>
                    <p className="text-xs text-slate-500 mt-1">Очередь обработки прайсов клиник-партнеров</p>
                  </div>

                  <div className="overflow-x-auto mt-4 flex-1">
                    <table className="w-full border-collapse text-left text-xs">
                      <thead>
                        <tr className="border-b border-slate-150 text-slate-500 font-semibold bg-slate-50/50">
                          <th className="py-2.5 px-3">Имя файла</th>
                          <th className="py-2.5 px-3">Партнер</th>
                          <th className="py-2.5 px-3">Дата загрузки</th>
                          <th className="py-2.5 px-3">Формат</th>
                          <th className="py-2.5 px-3 text-center">Статус</th>
                        </tr>
                      </thead>
                      <tbody>
                        {documents.slice(0, 5).map((doc, idx) => (
                          <tr key={idx} className="border-b border-slate-100 hover:bg-slate-50/50">
                            <td className="py-2.5 px-3 font-semibold text-slate-700 max-w-[180px] truncate">{doc.file_name}</td>
                            <td className="py-2.5 px-3 text-slate-500">{doc.partner_name || 'Определяется...'}</td>
                            <td className="py-2.5 px-3 text-slate-400">{doc.parsed_at ? new Date(doc.parsed_at).toLocaleString() : 'Очередь...'}</td>
                            <td className="py-2.5 px-3 uppercase text-[10px] font-bold text-slate-400">
                              {doc.file_format === 'zip' ? <span className="text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200">ZIP</span> : doc.file_format}
                            </td>
                            <td className="py-2.5 px-3 text-center">
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold inline-block border ${
                                doc.parse_status === 'done'
                                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                  : doc.parse_status === 'processing'
                                  ? 'bg-blue-50 text-blue-700 border-blue-200 animate-pulse'
                                  : doc.parse_status === 'needs_review'
                                  ? 'bg-amber-50 text-amber-700 border-amber-200'
                                  : doc.parse_status === 'error'
                                  ? 'bg-rose-50 text-rose-700 border-rose-200'
                                  : 'bg-slate-50 text-slate-500 border-slate-200'
                              }`}>
                                {doc.parse_status === 'done' && 'Успех'}
                                {doc.parse_status === 'processing' && 'Обработка'}
                                {doc.parse_status === 'needs_review' && 'Ревью'}
                                {doc.parse_status === 'error' && 'Ошибка'}
                                {doc.parse_status === 'pending' && 'В очереди'}
                              </span>
                            </td>
                          </tr>
                        ))}
                        {documents.length === 0 && (
                          <tr>
                            <td colSpan={5} className="py-8 text-center text-slate-400">
                              Документы еще не загружались
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>

                </div>

              </div>

            </div>
          )}

          {/* TAB 2: ARCHIVE PROCESSING DETAILS */}
          {activeTab === 'archive_processing' && (
            <div className="h-full bg-white border border-slate-200 rounded-2xl p-6 shadow-sm flex flex-col justify-between">
              <div className="max-w-xl mx-auto py-12 flex flex-col items-center text-center">
                <div className="w-20 h-20 bg-indigo-50 text-indigo-600 rounded-3xl flex items-center justify-center shadow-inner mb-6">
                  <FileArchive className="w-10 h-10" />
                </div>
                
                <h2 className="text-lg font-bold text-slate-800">Загрузка архива прейскурантов клиник</h2>
                <p className="text-xs text-slate-500 mt-2 max-w-sm">
                  Загрузите ZIP-архив, содержащий прайс-листы партнеров в форматах PDF, DOCX, XLSX или XLS. Наша система автоматически распакует архив и запустит параллельную фоновую разметку.
                </p>

                <div className="w-full mt-8">
                  {!uploading ? (
                    <label className="border-2 border-dashed border-slate-200 hover:border-indigo-400 bg-slate-50/50 hover:bg-slate-50 rounded-2xl p-10 flex flex-col items-center justify-center cursor-pointer transition-all min-h-[200px]">
                      <UploadCloud className="w-12 h-12 text-indigo-500 animate-bounce" />
                      <span className="text-sm font-semibold text-slate-700 mt-4">Нажмите для выбора ZIP-архива</span>
                      <span className="text-xs text-slate-400 mt-1">Файл .zip до 50MB</span>
                      <input type="file" onChange={handleUpload} className="hidden" accept=".zip" />
                    </label>
                  ) : (
                    <div className="border border-slate-100 bg-slate-50 rounded-2xl p-10 flex flex-col items-center justify-center min-h-[200px]">
                      <RefreshCw className="w-10 h-10 text-indigo-600 animate-spin" />
                      <span className="text-sm font-bold text-slate-700 mt-4">{uploadMessage}</span>
                      
                      <div className="w-full bg-slate-200 h-2 rounded-full overflow-hidden mt-4 max-w-xs">
                        <div className="bg-indigo-600 h-full rounded-full transition-all duration-300" style={{ width: `${uploadProgress}%` }}></div>
                      </div>
                    </div>
                  )}
                </div>

                <div className="mt-8 flex items-center gap-2 bg-indigo-50 border border-indigo-100 p-3 rounded-2xl text-left text-xs text-indigo-800">
                  <Info className="w-5 h-5 flex-shrink-0" />
                  <p>Клиники распознаются по содержимому документов с созданием новых карточек партнеров при необходимости.</p>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: PRICE DOCUMENTS REGISTRY */}
          {activeTab === 'price_documents' && (
            <div className="h-full bg-white border border-slate-200 rounded-2xl p-5 shadow-sm flex flex-col">
              <div className="flex items-center justify-between mb-4 flex-shrink-0">
                <div>
                  <h3 className="font-bold text-slate-800 text-sm">Обработанные прайс-листы</h3>
                  <p className="text-xs text-slate-500">Реестр документов и логи автоматической обработки</p>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto custom-scrollbar border border-slate-150 rounded-xl">
                <table className="w-full border-collapse text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-600 font-semibold bg-slate-50 h-10">
                      <th className="px-4">Файл</th>
                      <th className="px-4">Партнер</th>
                      <th className="px-4">Формат</th>
                      <th className="px-4">Дата прайса</th>
                      <th className="px-4">Загружен</th>
                      <th className="px-4">Лог / Ошибки</th>
                      <th className="px-4 text-center">Статус</th>
                    </tr>
                  </thead>
                  <tbody>
                    {documents.map((doc, idx) => (
                      <tr key={idx} className="border-b border-slate-100 hover:bg-slate-50/40">
                        <td className="px-4 py-3 font-semibold text-slate-800">{doc.file_name}</td>
                        <td className="px-4 py-3 text-slate-500 font-medium">{doc.partner_name || 'Определяется...'}</td>
                        <td className="px-4 py-3 uppercase text-[10px] font-bold text-slate-400">{doc.file_format}</td>
                        <td className="px-4 py-3 text-slate-500">{doc.effective_date ? new Date(doc.effective_date).toLocaleDateString() : 'Не определена'}</td>
                        <td className="px-4 py-3 text-slate-400">{new Date(doc.parsed_at).toLocaleString()}</td>
                        <td className="px-4 py-3 max-w-[300px] text-slate-600" title={doc.parse_log}>
                          {renderStructuredLogs(doc.parse_log)}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                            doc.parse_status === 'done'
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              : doc.parse_status === 'processing'
                              ? 'bg-blue-50 text-blue-700 border-blue-200 animate-pulse'
                              : doc.parse_status === 'needs_review'
                              ? 'bg-amber-50 text-amber-700 border-amber-200'
                              : doc.parse_status === 'error'
                              ? 'bg-rose-50 text-rose-700 border-rose-200'
                              : 'bg-slate-50 text-slate-500 border-slate-200'
                          }`}>
                            {doc.parse_status === 'done' && (
                              <>
                                <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                                <span>Успех</span>
                              </>
                            )}
                            {doc.parse_status === 'processing' && 'Обработка'}
                            {doc.parse_status === 'needs_review' && 'Ревью'}
                            {doc.parse_status === 'error' && 'Ошибка'}
                            {doc.parse_status === 'pending' && 'Очередь'}
                          </span>
                        </td>
                      </tr>
                    ))}
                    {documents.length === 0 && (
                      <tr>
                        <td colSpan={7} className="py-12 text-center text-slate-400">
                          Нет загруженных документов прайс-листов
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 4: MANUAL VERIFICATION QUEUE */}
          {activeTab === 'verification_queue' && (
            <div className="h-full bg-white border border-slate-200 rounded-2xl p-5 shadow-sm flex flex-col">
              <div className="mb-4 flex-shrink-0">
                <h3 className="font-bold text-slate-800 text-sm">Очередь верификации аномалий и предупреждений</h3>
                <p className="text-xs text-slate-500">Позиции, нарушающие бизнес-правила (аномалии цены &gt;50%, нарушения правил резидентов, будущие даты)</p>
              </div>

              <div className="flex-1 overflow-y-auto custom-scrollbar border border-slate-150 rounded-xl">
                <table className="w-full border-collapse text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-600 font-semibold bg-slate-50 h-10">
                      <th className="px-4">Услуга</th>
                      <th className="px-4">Клиника</th>
                      <th className="px-4">Файл</th>
                      <th className="px-4">Цена рез.</th>
                      <th className="px-4">Цена нерез.</th>
                      <th className="px-4">Причина проверки</th>
                      <th className="px-4 text-center">Действие</th>
                    </tr>
                  </thead>
                  <tbody>
                    {verifiedItems.map((item, idx) => (
                      <tr key={idx} className="border-b border-slate-100 hover:bg-slate-50/40">
                        <td className="px-4 py-3 max-w-[285px]">
                          <div className="font-semibold text-slate-800">
                            {item.service_name_normalized || item.service_name_raw}
                          </div>
                          {item.service_name_normalized && (
                            <div className="text-[9px] text-slate-400 font-normal italic mt-0.5">
                              Оригинал: {item.service_name_raw}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-slate-500 font-medium">{item.partner_name}</td>
                        <td className="px-4 py-3 text-slate-400 font-mono text-[10px]">
                          <div className="flex flex-col gap-1">
                            <span>{item.file_name}</span>
                            <a
                              href={`/api/uploads/${encodeURIComponent(item.file_name || '')}`}
                              download
                              className="text-indigo-600 hover:text-indigo-800 font-medium hover:underline inline-flex items-center gap-0.5 text-[9px]"
                            >
                              <Download className="w-3 h-3" />
                              Скачать оригинал
                            </a>
                          </div>
                        </td>
                        <td className="px-4 py-3 font-bold text-slate-700">{item.price_resident_kzt} KZT</td>
                        <td className="px-4 py-3 text-slate-500">{item.price_nonresident_kzt} {item.currency_original || 'KZT'}</td>
                        <td className="px-4 py-3 text-amber-700 bg-amber-50/40 font-medium">
                          <div className="flex items-center gap-1">
                            <AlertTriangle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
                            <span>{item.verification_note}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              onClick={async () => {
                                const originalState = {
                                  item_id: item.item_id,
                                  service_id: item.service_id,
                                  service_name_raw: item.service_name_raw,
                                  price_resident_kzt: item.price_resident_kzt,
                                  price_nonresident_kzt: item.price_nonresident_kzt,
                                  currency_original: item.currency_original,
                                  is_verified: item.is_verified,
                                  verification_note: item.verification_note
                                };

                                try {
                                  const res = await fetch('/api/verify', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({
                                      item_id: item.item_id,
                                      is_verified: true,
                                      verification_note: 'Подтверждено вручную оператором'
                                    })
                                  });
                                  if (res.ok) {
                                    showToast('Запись успешно верифицирована!', 'success');

                                    const action = {
                                      id: 'action-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5),
                                      type: 'verify' as const,
                                      itemId: item.item_id,
                                      itemNameRaw: item.service_name_raw,
                                      oldState: originalState,
                                      timestamp: new Date().toISOString()
                                    };
                                    addUndoAction(action);

                                    refreshAllData();
                                  } else {
                                    showToast('Ошибка при верификации позиции', 'error');
                                  }
                                } catch (e) {
                                  showToast('Сбой соединения', 'error');
                                }
                              }}
                              className="h-8 px-3 bg-emerald-600 text-white font-bold rounded-lg text-[11px] hover:bg-emerald-700 transition cursor-pointer"
                            >
                              Подтвердить
                            </button>
                            <button
                              onClick={() => startEditingItem(item)}
                              className="h-8 px-2 bg-slate-100 text-slate-700 hover:bg-slate-200 rounded-lg text-[11px] font-bold transition cursor-pointer"
                              title="Редактировать позицию"
                            >
                              Редактировать
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {verifiedItems.length === 0 && (
                      <tr>
                        <td colSpan={7} className="py-12 text-center text-slate-400">
                          Очередь верификации аномалий пуста
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Undo action history section */}
              {undoHistory.length > 0 && (
                <div className="mt-5 border-t border-slate-100 pt-4 flex-shrink-0">
                  <h4 className="font-bold text-slate-800 text-xs mb-3 flex items-center gap-1.5">
                    <History className="w-4 h-4 text-slate-500" />
                    История ваших недавних действий (с возможностью отмены)
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[140px] overflow-y-auto custom-scrollbar pr-1">
                    {undoHistory.map((action, idx) => (
                      <div key={idx} className="bg-slate-50/70 border border-slate-200 rounded-xl p-3 flex items-center justify-between text-xs">
                        <div className="min-w-0 pr-4">
                          <span className={`inline-block px-1.5 py-0.5 rounded-[4px] text-[9px] font-extrabold uppercase mr-1.5 ${
                            action.type === 'match' ? 'bg-indigo-50 text-indigo-700 border border-indigo-200' :
                            action.type === 'verify' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
                            'bg-amber-50 text-amber-700 border border-amber-200'
                          }`}>
                            {action.type === 'match' ? 'Сопоставление' : action.type === 'verify' ? 'Верификация' : 'Редактирование'}
                          </span>
                          <span className="font-semibold text-slate-800 truncate block mt-1" title={action.itemNameRaw}>
                            {action.itemNameRaw}
                          </span>
                          <span className="block text-[10px] text-slate-400 mt-0.5">
                            {new Date(action.timestamp).toLocaleTimeString()}
                          </span>
                        </div>
                        <button
                          onClick={() => handleUndo(action)}
                          className="px-2.5 py-1 bg-slate-200 hover:bg-rose-100 hover:text-rose-700 font-bold rounded-lg text-[10px] text-slate-700 cursor-pointer transition flex-shrink-0"
                        >
                          Отменить
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

            </div>
          )}

          {/* TAB 5: UNMATCHED SERVICES MAPPING */}
          {activeTab === 'unmatched_services' && (
            <div className="h-full flex gap-6 overflow-hidden">
              
              {/* Left Column: Unmatched List */}
              <div className="flex-1 bg-white border border-slate-200 rounded-2xl p-5 shadow-sm flex flex-col overflow-hidden">
                <div className="mb-4">
                  <h3 className="font-bold text-slate-800 text-sm">Несопоставленные позиции прайсов</h3>
                  <p className="text-xs text-slate-500">Система не смогла уверенно сопоставить данные строки со справочником</p>
                </div>

                <div className="flex-1 overflow-y-auto custom-scrollbar border border-slate-150 rounded-xl">
                  <table className="w-full border-collapse text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 text-slate-600 font-semibold bg-slate-50 h-10 sticky top-0">
                        <th className="px-4">Исходное наименование услуги</th>
                        <th className="px-4">Клиника</th>
                        <th className="px-4">Файл</th>
                        <th className="px-4">Цена</th>
                        <th className="px-4 text-center">Выбрать</th>
                      </tr>
                    </thead>
                    <tbody>
                      {unmatchedItems.map((item, idx) => {
                        const isSelected = selectedUnmatchedItem?.item_id === item.item_id;
                        return (
                          <tr key={idx} className={`border-b border-slate-100 hover:bg-slate-50/40 ${isSelected ? 'bg-indigo-50/40 hover:bg-indigo-50/40' : ''}`}>
                            <td className="px-4 py-3 font-semibold text-slate-800 max-w-[280px] truncate">{item.service_name_raw}</td>
                            <td className="px-4 py-3 text-slate-500">{item.partner_name}</td>
                            <td className="px-4 py-3 text-slate-400 font-mono text-[10px]">
                              <div className="flex flex-col gap-0.5">
                                <span className="truncate max-w-[100px]" title={item.file_name}>{item.file_name}</span>
                                <a
                                  href={`/api/uploads/${encodeURIComponent(item.file_name || '')}`}
                                  download
                                  className="text-indigo-600 hover:text-indigo-800 font-medium hover:underline inline-flex items-center gap-0.5 text-[9px]"
                                >
                                  <Download className="w-3 h-3" />
                                  Скачать
                                </a>
                              </div>
                            </td>
                            <td className="px-4 py-3 font-bold text-slate-700">{item.price_resident_kzt} KZT</td>
                            <td className="px-4 py-3 text-center">
                              <div className="flex items-center justify-center gap-1.5">
                                <button
                                  onClick={() => {
                                    setSelectedUnmatchedItem(item);
                                    setMappingSearch(item.service_name_raw);
                                  }}
                                  className={`h-8 px-3 rounded-lg text-[11px] font-bold transition cursor-pointer ${
                                    isSelected
                                      ? 'bg-indigo-600 text-white'
                                      : 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100'
                                  }`}
                                >
                                  {isSelected ? 'Выбрано' : 'Разметить'}
                                </button>
                                <button
                                  onClick={() => startEditingItem(item)}
                                  className="h-8 px-2 bg-slate-100 text-slate-700 hover:bg-slate-200 rounded-lg text-[11px] font-bold transition cursor-pointer"
                                  title="Редактировать позицию"
                                >
                                  Редактировать
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                      {unmatchedItems.length === 0 && (
                        <tr>
                          <td colSpan={4} className="py-12 text-center text-slate-400">
                            Все позиции сопоставлены!
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Right Column: Catalog Search & Resolution */}
              <div className="w-[380px] bg-white border border-slate-200 rounded-2xl p-5 shadow-sm flex flex-col justify-between overflow-hidden">
                <div>
                  <h3 className="font-bold text-slate-800 text-sm">Связать со справочником</h3>
                  <p className="text-xs text-slate-500 mt-1">Выберите целевую услугу для сопоставления</p>

                  {selectedUnmatchedItem ? (
                    <div className="mt-4">
                      <div className="bg-slate-50 rounded-xl p-3 border border-slate-200">
                        <span className="text-[10px] text-slate-400 uppercase font-bold">Выбранная позиция:</span>
                        <p className="text-xs font-bold text-slate-800 mt-0.5">{selectedUnmatchedItem.service_name_raw}</p>
                        <p className="text-[11px] text-slate-500 mt-1">Клиника: {selectedUnmatchedItem.partner_name}</p>
                      </div>

                      {/* Autocomplete Input */}
                      <div className="mt-4 flex flex-col gap-2">
                        <label className="text-[11px] font-bold text-slate-600">Поиск в справочнике:</label>
                        <div className="relative">
                          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                          <input
                            type="text"
                            value={mappingSearch}
                            onChange={(e) => setMappingSearch(e.target.value)}
                            placeholder="Введите название для поиска..."
                            className="w-full h-10 pl-9 pr-4 bg-white border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
                          />
                        </div>
                      </div>

                      {/* Matching Results list */}
                      <div className="mt-3 overflow-y-auto max-h-[220px] border border-slate-150 rounded-xl divide-y divide-slate-100 custom-scrollbar">
                        {services
                          .filter((s) => s.service_name.toLowerCase().includes(mappingSearch.toLowerCase()))
                          .slice(0, 5)
                          .map((s, idx) => (
                            <button
                              key={idx}
                              onClick={() => handleManualMatchSubmit(s.service_id)}
                              className="w-full text-left p-3 hover:bg-indigo-50/50 flex items-center justify-between text-xs transition cursor-pointer"
                            >
                              <div className="max-w-[260px] truncate">
                                <p className="font-semibold text-slate-800">{s.service_name}</p>
                                <span className="text-[10px] text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded mt-1 inline-block">
                                  {s.category}
                                </span>
                              </div>
                              <ArrowRight className="w-4 h-4 text-indigo-500 opacity-0 group-hover:opacity-100" />
                            </button>
                          ))}
                        {services.filter((s) => s.service_name.toLowerCase().includes(mappingSearch.toLowerCase())).length === 0 && (
                          <div className="p-4 text-center text-xs text-slate-400">
                            Ничего не найдено
                          </div>
                        )}
                      </div>

                      <div className="mt-4 flex flex-col gap-2">
                        <label className="text-[11px] font-bold text-slate-600">Комментарий оператора (опционально):</label>
                        <textarea
                          value={mappingNote}
                          onChange={(e) => setMappingNote(e.target.value)}
                          placeholder="Причина сопоставления..."
                          className="w-full h-16 p-3 bg-white border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500 resize-none"
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="flex-1 flex flex-col items-center justify-center py-20 text-center text-slate-400">
                      <ZapOff className="w-12 h-12 text-slate-300" />
                      <p className="text-xs mt-3">Выберите позицию в списке слева для начала сопоставления.</p>
                    </div>
                  )}
                </div>

                {selectedUnmatchedItem && (
                  <button
                    onClick={() => {
                      setSelectedUnmatchedItem(null);
                      setMappingSearch('');
                      setMappingNote('');
                    }}
                    className="w-full h-10 bg-slate-100 text-slate-700 font-bold rounded-xl text-xs hover:bg-slate-200 transition mt-4 cursor-pointer"
                  >
                    Отмена
                  </button>
                )}
              </div>

            </div>
          )}

          {/* TAB 6: TARGET SERVICE CATALOG */}
          {activeTab === 'service_catalog' && (
            <div className="h-full bg-white border border-slate-200 rounded-2xl p-5 shadow-sm flex flex-col">
              
              {/* Header and Controls */}
              <div className="flex items-center justify-between mb-4 flex-shrink-0">
                <div>
                  <h3 className="font-bold text-slate-800 text-sm">Справочник медицинских услуг</h3>
                  <p className="text-xs text-slate-500">Базовый целевой каталог услуг и синонимы</p>
                </div>

                <div className="flex items-center gap-3">
                  <div className="relative">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Поиск по названию или коду..."
                      className="w-60 h-10 pl-9 pr-4 bg-white border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500 shadow-sm"
                    />
                  </div>

                  <div className="flex items-center gap-1.5">
                    <Filter className="w-4 h-4 text-slate-400" />
                    <select
                      value={categoryFilter}
                      onChange={(e) => setCategoryFilter(e.target.value)}
                      className="h-10 px-3 bg-white border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500 shadow-sm cursor-pointer"
                    >
                      <option value="ALL">Все категории</option>
                      {categoriesList.map((cat, idx) => (
                        <option key={idx} value={cat}>{cat}</option>
                      ))}
                    </select>
                  </div>

                  <label className={`h-10 px-3 border rounded-xl text-xs font-bold flex items-center justify-center gap-2 cursor-pointer transition-all shadow-sm ${
                    catalogFileUploading 
                      ? 'bg-slate-100 text-slate-400 border-slate-200' 
                      : 'bg-indigo-600 text-white border-indigo-600 hover:bg-indigo-700'
                  }`}>
                    {catalogFileUploading ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Plus className="w-3.5 h-3.5" />
                    )}
                    <span>Загрузить справочник</span>
                    <input type="file" onChange={handleCatalogUpload} className="hidden" accept=".xlsx,.xls,.json" disabled={catalogFileUploading} />
                  </label>

                  <button
                    onClick={startCreatingService}
                    className="h-10 px-4 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs flex items-center gap-1.5 cursor-pointer shadow-sm transition"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Добавить услугу</span>
                  </button>
                </div>
              </div>

              {/* Catalog Table */}
              <div className="flex-1 overflow-y-auto custom-scrollbar border border-slate-150 rounded-xl">
                <table className="w-full border-collapse text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-600 font-semibold bg-slate-50 h-10 sticky top-0">
                      <th className="px-4">ID</th>
                      <th className="px-4">Официальное название</th>
                      <th className="px-4">Категория</th>
                      <th className="px-4">Синонимы</th>
                      <th className="px-4">Код МКБ</th>
                      <th className="px-4 text-center">Статус</th>
                      <th className="px-4 text-center w-36">Действие</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredCatalog.map((s, idx) => {
                      let synonyms: string[] = [];
                      try {
                        synonyms = typeof s.synonyms === 'string' ? JSON.parse(s.synonyms) : (s.synonyms || []);
                      } catch (e) {}

                      return (
                        <tr key={idx} className="border-b border-slate-100 hover:bg-slate-50/40">
                          <td className="px-4 py-3 font-mono text-[10px] text-slate-400">{s.service_id.substring(0, 8)}...</td>
                          <td className="px-4 py-3 font-semibold text-slate-800">{s.service_name}</td>
                          <td className="px-4 py-3 text-slate-500 font-medium">{s.category}</td>
                          <td className="px-4 py-3 max-w-[240px] truncate text-slate-400">
                            {synonyms.length > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                {synonyms.slice(0, 2).map((syn, synIdx) => (
                                  <span key={synIdx} className="bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded text-[10px]">
                                    {syn}
                                  </span>
                                ))}
                                {synonyms.length > 2 && <span className="text-[10px]">+{synonyms.length - 2}</span>}
                              </div>
                            ) : (
                              <span>Синонимы отсутствуют</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-slate-400 font-mono">{s.icd_code || '—'}</td>
                          <td className="px-4 py-3 text-center">
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                              s.is_active 
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200' 
                                : 'bg-slate-100 text-slate-400 border-slate-200'
                            }`}>
                              {s.is_active ? 'Активен' : 'Неактивен'}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-center">
                            <div className="flex items-center justify-center gap-1.5">
                              <button
                                onClick={() => startEditingService(s)}
                                className="h-7 px-2 bg-slate-100 text-slate-700 hover:bg-slate-200 rounded-lg text-[10px] font-bold transition cursor-pointer"
                                title="Редактировать"
                              >
                                Изменить
                              </button>
                              <button
                                onClick={() => handleDeleteService(s.service_id)}
                                className="h-7 px-2 bg-rose-50 text-rose-600 hover:bg-rose-100 rounded-lg text-[10px] font-bold transition cursor-pointer"
                                title="Удалить / Деактивировать"
                              >
                                Удалить
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    {filteredCatalog.length === 0 && (
                      <tr>
                        <td colSpan={7} className="py-12 text-center text-slate-400">
                          Справочник пуст. Загрузите файл XLSX или JSON для наполнения.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

            </div>
          )}

          {/* TAB 7: CLINIC PARTNERS LIST */}
          {activeTab === 'partners' && (
            <div className="h-full bg-white border border-slate-200 rounded-2xl p-5 shadow-sm flex flex-col">
              
              {/* Header */}
              <div className="flex items-center justify-between mb-4 flex-shrink-0">
                <div>
                  <h3 className="font-bold text-slate-800 text-sm">Клиники-партнеры</h3>
                  <p className="text-xs text-slate-500">Реестр подключенных медицинских центров и филиалов</p>
                </div>

                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1.5">
                    <Map className="w-4 h-4 text-slate-400" />
                    <select
                      value={categoryFilter}
                      onChange={(e) => setCategoryFilter(e.target.value)}
                      className="h-10 px-3 bg-white border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500 shadow-sm cursor-pointer"
                    >
                      <option value="ALL">Все города</option>
                      {citiesList.map((city, idx) => (
                        <option key={idx} value={city}>{city}</option>
                      ))}
                    </select>
                  </div>

                  <button
                    onClick={startCreatingPartner}
                    className="h-10 px-4 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-xs flex items-center gap-1.5 cursor-pointer shadow-sm transition"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Добавить партнера</span>
                  </button>
                </div>
              </div>

              {/* Partners Grid */}
              <div className="flex-1 overflow-y-auto custom-scrollbar pr-1">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                  {filteredPartners.map((p, idx) => (
                    <div key={idx} className="bg-slate-50/50 hover:bg-slate-50 border border-slate-200 rounded-2xl p-5 transition-all shadow-xs flex flex-col justify-between min-h-[180px]">
                      <div>
                        <div className="flex items-center justify-between">
                          <h4 className="font-bold text-slate-800 text-sm truncate max-w-[180px]">{p.name}</h4>
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${
                            p.is_active 
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200' 
                              : 'bg-slate-100 text-slate-400 border-slate-200'
                          }`}>
                            {p.is_active ? 'Активен' : 'Неактивен'}
                          </span>
                        </div>
                        <p className="text-[10px] text-slate-400 mt-0.5">БИН: {p.bin || '—'}</p>
                        
                        <div className="mt-4 flex flex-col gap-1.5 text-xs text-slate-500">
                          <div className="flex items-center gap-1.5">
                            <MapPin className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                            <span className="truncate">{p.city ? `${p.city}, ${p.address || ''}` : 'Адрес не указан'}</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <Mail className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                            <span className="truncate">{p.contact_email || 'Email отсутствует'}</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <Phone className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                            <span>{p.contact_phone || 'Телефон отсутствует'}</span>
                          </div>
                        </div>
                      </div>

                      <div className="border-t border-slate-150 pt-3 mt-4 flex flex-col gap-2">
                        <div className="flex items-center justify-between text-[10px] text-slate-400">
                          <span>Добавлен: {new Date(p.created_at).toLocaleDateString()}</span>
                          <button
                            onClick={() => {
                              setActiveTab('price_explorer');
                            }}
                            className="text-indigo-600 hover:text-indigo-800 font-bold cursor-pointer"
                          >
                            Смотреть услуги
                          </button>
                        </div>
                        <div className="flex items-center justify-end gap-2.5 text-[10px] pt-2 border-t border-dashed border-slate-100">
                          <button
                            onClick={() => startEditingPartner(p)}
                            className="text-indigo-600 hover:text-indigo-800 font-bold cursor-pointer"
                          >
                            Изменить
                          </button>
                          <span className="text-slate-300">•</span>
                          <button
                            onClick={() => handleDeletePartner(p.partner_id)}
                            className="text-rose-600 hover:text-rose-800 font-bold cursor-pointer"
                          >
                            Удалить
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                  {filteredPartners.length === 0 && (
                    <div className="col-span-3 py-16 text-center text-slate-400">
                      Клиники не зарегистрированы в системе. Загрузите прайс-лист для автоматического создания клиники.
                    </div>
                  )}
                </div>
              </div>

            </div>
          )}

          {/* TAB 8: PRICE EXPLORER SEARCH */}
          {activeTab === 'price_explorer' && (
            <div className="h-full flex gap-6 overflow-hidden">
              
              {/* Left Column: Explorer Search Form & Results */}
              <div className="flex-1 bg-white border border-slate-200 rounded-2xl p-5 shadow-sm flex flex-col overflow-hidden">
                <div className="mb-4">
                  <h3 className="font-bold text-slate-800 text-sm">Поиск медицинских услуг</h3>
                  <p className="text-xs text-slate-500">Введите ключевые слова для поиска по каталогу</p>
                </div>

                <form onSubmit={handleExplorerSearch} className="flex gap-2 flex-shrink-0 mb-4">
                  <div className="relative flex-1">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3.5" />
                    <input
                      type="text"
                      value={explorerQuery}
                      onChange={(e) => setExplorerQuery(e.target.value)}
                      placeholder="Например: терапевт, УЗИ, МРТ..."
                      className="w-full h-11 pl-9 pr-4 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500 shadow-sm"
                    />
                  </div>
                  <button type="submit" className="h-11 px-5 bg-indigo-600 text-white font-bold rounded-xl text-xs hover:bg-indigo-700 transition cursor-pointer shadow-sm">
                    Найти
                  </button>
                </form>

                {/* Results list */}
                <div className="flex-1 overflow-y-auto custom-scrollbar border border-slate-150 rounded-xl divide-y divide-slate-150 bg-slate-50/20">
                  {explorerResults.services.map((service, idx) => (
                    <button
                      key={idx}
                      onClick={() => handleSelectExplorerService(service)}
                      className={`w-full text-left p-4 hover:bg-indigo-50/20 flex items-center justify-between transition cursor-pointer ${
                        selectedExplorerService?.service_id === service.service_id ? 'bg-indigo-50/40' : ''
                      }`}
                    >
                      <div>
                        <h4 className="font-bold text-slate-800 text-xs">{service.service_name}</h4>
                        <div className="flex items-center gap-2 mt-1.5 text-[10px] text-slate-400">
                          <span className="bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded font-medium">{service.category}</span>
                          {service.icd_code && <span className="font-mono">МКБ: {service.icd_code}</span>}
                        </div>
                      </div>
                      <ArrowRight className="w-4 h-4 text-indigo-500" />
                    </button>
                  ))}
                  {explorerQuery && explorerResults.services.length === 0 && (
                    <div className="p-12 text-center text-xs text-slate-400">
                      По вашему запросу услуг не найдено
                    </div>
                  )}
                  {!explorerQuery && (
                    <div className="p-12 text-center text-xs text-slate-400 flex flex-col items-center justify-center gap-2">
                      <Search className="w-8 h-8 text-slate-300" />
                      <p>Введите поисковый запрос выше.</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Right Column: Partners Rendering Service & Prices */}
              <div className="w-[420px] bg-white border border-slate-200 rounded-2xl p-5 shadow-sm flex flex-col overflow-hidden">
                <h3 className="font-bold text-slate-800 text-sm flex-shrink-0">Стоимость в клиниках-партнерах</h3>
                
                {selectedExplorerService ? (
                  <div className="mt-4 flex-1 flex flex-col overflow-hidden">
                    <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-3.5 flex-shrink-0">
                      <span className="text-[10px] text-indigo-700 uppercase font-bold">{selectedExplorerService.category}</span>
                      <h4 className="text-xs font-bold text-slate-800 mt-1">{selectedExplorerService.service_name}</h4>
                    </div>

                    <div className="flex-1 overflow-y-auto custom-scrollbar divide-y divide-slate-150 border border-slate-150 rounded-xl mt-4">
                      {explorerServiceClinics.map((clinic, idx) => (
                        <div key={idx} className="p-4 hover:bg-slate-50/50 flex flex-col gap-2">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="font-bold text-slate-800 text-xs truncate">{clinic.partner_name}</span>
                              {clinic.is_verified && (
                                <span title="Верифицировано" className="flex-shrink-0">
                                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                                </span>
                              )}
                            </div>
                            <span className="text-[10px] text-slate-400 font-mono flex-shrink-0">{clinic.city}</span>
                          </div>

                          <div className="grid grid-cols-2 gap-4 text-xs mt-1">
                            <div className="bg-emerald-50/50 border border-emerald-100 p-2 rounded-lg">
                              <span className="text-[9px] text-emerald-600 uppercase font-semibold">Резидент:</span>
                              <p className="font-bold text-emerald-800 mt-0.5">{clinic.price_resident_kzt} KZT</p>
                            </div>
                            <div className="bg-blue-50/50 border border-blue-100 p-2 rounded-lg">
                              <span className="text-[9px] text-blue-600 uppercase font-semibold">Нерезидент:</span>
                              <p className="font-bold text-blue-800 mt-0.5">{clinic.price_nonresident_kzt} {clinic.currency_original || 'KZT'}</p>
                            </div>
                          </div>

                          <div className="flex items-center justify-between text-[9px] text-slate-400 mt-1 border-t border-slate-100 pt-2">
                            <div className="flex flex-col">
                              <span>Обновлено: {new Date(clinic.effective_date).toLocaleDateString()}</span>
                              {clinic.currency_original !== 'KZT' && (
                                <span className="mt-0.5">Оригинал: {clinic.price_original} {clinic.currency_original}</span>
                              )}
                            </div>
                            <button
                              onClick={() => handleViewHistory(clinic)}
                              className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-lg text-[9px] flex items-center gap-1 cursor-pointer transition"
                            >
                              <History className="w-3 h-3 text-slate-500" />
                              <span>История</span>
                            </button>
                          </div>
                        </div>
                      ))}
                      {explorerServiceClinics.length === 0 && (
                        <div className="p-12 text-center text-xs text-slate-400">
                          Данную услугу еще никто из партнеров не оказывает
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center py-20 text-center text-slate-400">
                    <Search className="w-12 h-12 text-slate-300" />
                    <p className="text-xs mt-3 max-w-[200px]">Выберите услугу из списка слева, чтобы сравнить цены клиник.</p>
                  </div>
                )}
              </div>

            </div>
          )}

          {/* TAB 9: API CENTER */}
          {activeTab === 'api_center' && (
            <div className="h-full bg-white border border-slate-200 rounded-2xl p-6 shadow-sm flex flex-col overflow-y-auto custom-scrollbar gap-6">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between border-b border-slate-100 pb-4 gap-4 flex-shrink-0">
                <div>
                  <h3 className="font-bold text-slate-800 text-sm">MedPartners REST API</h3>
                  <p className="text-xs text-slate-500 mt-1">Интеграционная документация OpenAPI / Swagger для подключения к сторонним системам</p>
                </div>
                <div className="flex items-center gap-2">
                  <a
                    href="/openapi.yaml"
                    download
                    className="h-9 px-4 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-xs flex items-center gap-1.5 cursor-pointer shadow-sm transition"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Скачать OpenAPI Спецификацию</span>
                  </a>
                  <a
                    href="https://editor.swagger.io/?url=http://localhost:3000/openapi.yaml"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="h-9 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 font-bold rounded-xl text-xs flex items-center gap-1.5 cursor-pointer transition"
                  >
                    <Activity className="w-3.5 h-3.5" />
                    <span>Проверить в Swagger Editor</span>
                  </a>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {[
                  { method: 'GET', path: '/api/services', desc: 'Список услуг справочника с фильтрацией по категории' },
                  { method: 'GET', path: '/api/services/{id}/partners', desc: 'Список партнеров, оказывающих услугу, с ценами' },
                  { method: 'GET', path: '/api/partners', desc: 'Список партнеров с фильтрацией по городу и статусу' },
                  { method: 'GET', path: '/api/partners/{id}/services', desc: 'Все услуги конкретного партнера с ценами' },
                  { method: 'GET', path: '/api/search?q={query}', desc: 'Полнотекстовый поиск по услугам и клиникам' },
                  { method: 'GET', path: '/api/unmatched', desc: 'Список несопоставленных позиций прайсов' },
                  { method: 'POST', path: '/api/match', desc: 'Ручное сопоставление позиции прайса со справочником' },
                  { method: 'POST', path: '/api/verify', desc: 'Ручное подтверждение / верификация цены (аномалии, нарушения правил резидентов)' },
                  { method: 'GET', path: '/api/dashboard', desc: 'Статистика работы процессора' },
                ].map((api, idx) => (
                  <div key={idx} className="border border-slate-200 p-4 rounded-xl hover:bg-slate-50/50 transition">
                    <div className="flex items-center gap-3">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        api.method === 'GET' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-indigo-50 text-indigo-700 border border-indigo-200'
                      }`}>
                        {api.method}
                      </span>
                      <span className="font-mono text-xs font-semibold text-slate-800">{api.path}</span>
                    </div>
                    <p className="text-xs text-slate-500 mt-2">{api.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 10: SETTINGS */}
          {activeTab === 'settings' && (
            <div className="h-full bg-white border border-slate-200 rounded-2xl p-6 shadow-sm flex flex-col gap-6 max-w-2xl">
              <div>
                <h3 className="font-bold text-slate-800 text-sm">Настройки системы</h3>
                <p className="text-xs text-slate-500 mt-1">Конфигурация бизнес-правил разбора и валютных ставок</p>
              </div>

              <div className="flex flex-col gap-4 text-xs">
                
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <div>
                    <h4 className="font-semibold text-slate-800">Автоматическое определение категории</h4>
                    <p className="text-[11px] text-slate-400 mt-0.5">Классифицировать неопределенные позиции с помощью ИИ</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={autoCategory}
                    onChange={(e) => handleSaveSettings({ autoCategory: e.target.checked })}
                    className="w-4 h-4 text-indigo-600 border-slate-300 rounded cursor-pointer"
                  />
                </div>

                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <div>
                    <h4 className="font-semibold text-slate-800">Валюта по умолчанию</h4>
                    <p className="text-[11px] text-slate-400 mt-0.5">Базовая валюта для расчета медианы цен</p>
                  </div>
                  <select
                    value={defaultCurrency}
                    onChange={(e) => handleSaveSettings({ defaultCurrency: e.target.value })}
                    className="h-9 px-3 bg-white border border-slate-200 rounded-lg text-xs"
                  >
                    <option value="KZT">Казахстанский тенге (KZT)</option>
                    <option value="USD">Доллар США (USD)</option>
                    <option value="RUB">Российский рубль (RUB)</option>
                  </select>
                </div>

                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <div>
                    <h4 className="font-semibold text-slate-800">Порог автосопоставления (Auto-Match)</h4>
                    <p className="text-[11px] text-slate-400 mt-0.5">Минимальная схожесть для автоматического подтверждения услуги (0.0 - 1.0)</p>
                  </div>
                  <input
                    type="number"
                    step="0.05"
                    min="0.1"
                    max="1.0"
                    value={autoMatchThreshold}
                    onChange={(e) => handleSaveSettings({ autoMatchThreshold: parseFloat(e.target.value) })}
                    className="h-9 w-20 px-3 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-800"
                  />
                </div>

                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <div>
                    <h4 className="font-semibold text-slate-800">Порог ручной верификации</h4>
                    <p className="text-[11px] text-slate-400 mt-0.5">Минимальная схожесть для автоматического предложения сопоставления (0.0 - 1.0)</p>
                  </div>
                  <input
                    type="number"
                    step="0.05"
                    min="0.1"
                    max="1.0"
                    value={manualReviewThreshold}
                    onChange={(e) => handleSaveSettings({ manualReviewThreshold: parseFloat(e.target.value) })}
                    className="h-9 w-20 px-3 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-800"
                  />
                </div>

                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <div>
                    <h4 className="font-semibold text-slate-800">Курс конвертации USD/KZT</h4>
                    <p className="text-[11px] text-slate-400 mt-0.5">Настраиваемый курс для пересчета валютных позиций</p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number"
                      step="1"
                      min="1"
                      value={usdRate}
                      onChange={(e) => handleSaveSettings({ usdRate: parseFloat(e.target.value) })}
                      className="h-9 w-24 px-3 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-800"
                    />
                    <span className="text-xs font-semibold text-slate-500">KZT</span>
                  </div>
                </div>

                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <div>
                    <h4 className="font-semibold text-slate-800">Курс конвертации RUB/KZT</h4>
                    <p className="text-[11px] text-slate-400 mt-0.5">Настраиваемый курс для пересчета валютных позиций</p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number"
                      step="0.1"
                      min="0.1"
                      value={rubRate}
                      onChange={(e) => handleSaveSettings({ rubRate: parseFloat(e.target.value) })}
                      className="h-9 w-24 px-3 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-800"
                    />
                    <span className="text-xs font-semibold text-slate-500">KZT</span>
                  </div>
                </div>

              </div>
            </div>
          )}

        </div>

      </main>
    </div>
  );
}




