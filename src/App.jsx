import React, { useState, useEffect, useMemo, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  signInAnonymously, 
  onAuthStateChanged 
} from 'firebase/auth';
import { 
  getFirestore, 
  doc, 
  setDoc, 
  getDoc, 
  collection, 
  addDoc, 
  onSnapshot, 
  deleteDoc,
  query,
  orderBy 
} from 'firebase/firestore';
import { 
  PlusCircle, 
  FileText, 
  User, 
  Calendar, 
  Clock, 
  AlertCircle, 
  CheckCircle2, 
  Trash2,
  Wallet,
  Printer
} from 'lucide-react';

// ==========================================
// KONFIGURASI FIREBASE
// Ganti dengan konfigurasi project Firebase Anda
// (Jika belum dikonfigurasi, aplikasi otomatis menyimpan ke penyimpanan perangkat / LocalStorage)
// ==========================================
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyYourApiKeyHere",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "your-project-id.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "your-project-id",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "your-project-id.appspot.com",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "1234567890",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:1234567890:web:abcdef123456"
};

const isFirebaseConfigured = 
  firebaseConfig.apiKey !== "AIzaSyYourApiKeyHere" && 
  firebaseConfig.projectId !== "your-project-id";

let app = null;
let auth = null;
let db = null;

if (isFirebaseConfigured) {
  try {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
  } catch (err) {
    console.warn("Firebase gagal diinisialisasi, menggunakan penyimpanan lokal:", err);
  }
}

// ==========================================
// FUNGSI HELPER & LOGIKA PERHITUNGAN
// ==========================================

/**
 * Menghitung Jam Efektif berdasarkan durasi aktual dan status hari libur
 */
const hitungJamEfektif = (durasi, isLibur) => {
  const jam = parseFloat(durasi);
  if (isNaN(jam) || jam <= 0) return 0;

  let efektif = 0;

  if (!isLibur) {
    // A. Hari Biasa (Senin - Sabtu)
    // Jam ke-1 = x1.5, Jam ke-2 s/d ke-7 (dan seterusnya) = x2
    const jamPertama = Math.min(jam, 1);
    const sisaJam = Math.max(0, jam - 1);
    efektif = (jamPertama * 1.5) + (sisaJam * 2);
  } else {
    // B. Hari Libur / Minggu
    // 7 jam pertama = x2
    // Jam ke-8 = x3
    // Jam ke-9 dst = x4
    const jam7Pertama = Math.min(jam, 7);
    const jamKe8 = Math.max(0, Math.min(jam - 7, 1));
    const jamKe9Dst = Math.max(0, jam - 8);

    efektif = (jam7Pertama * 2) + (jamKe8 * 3) + (jamKe9Dst * 4);
  }

  return Number(efektif.toFixed(2));
};

/**
 * Format angka ke mata uang Rupiah
 */
const formatRupiah = (angka) => {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(angka);
};

/**
 * Format angka integer dengan pemisah ribuan titik (contoh: 4500000 -> 4.500.000)
 */
const formatRibuan = (val) => {
  if (val === undefined || val === null || val === '') return '';
  const cleanDigits = String(val).replace(/\D/g, '');
  if (!cleanDigits) return '';
  return cleanDigits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
};

const NAMA_BULAN = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
];

const NAMA_HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

/**
 * Daftar Libur Resmi Kalender Pabrik (Format MM-DD)
 * Mengacu pada kalender pabrik: tanggal seperti 10 November (Hari Pahlawan) BUKAN libur pabrik.
 * Sedangkan 25 Desember ditandai blok merah pada kalender pabrik.
 */
const LIBUR_KALENDER_PABRIK_MMDD = {
  '01-01': 'Tahun Baru Masehi (Libur Pabrik)',
  '08-17': 'HUT Kemerdekaan RI (Libur Pabrik)',
  '12-25': 'Hari Raya Natal (Libur Kalender Pabrik)'
};

/**
 * Mengecek apakah suatu tanggal (YYYY-MM-DD) merupakan Hari Libur menurut Kalender Pabrik
 * (Hanya hari Minggu atau tanggal yang diblok merah di Kalender Pabrik)
 */
const cekHariLiburPabrik = (ymdStr) => {
  if (!ymdStr) return { isLibur: false, keterangan: 'Hari Kerja Pabrik' };
  const [y, m, d] = ymdStr.split('-').map(Number);
  const dateObj = new Date(y, m - 1, d);
  const dayOfWeek = dateObj.getDay();
  const namaHari = NAMA_HARI[dayOfWeek];
  const mmdd = `${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

  if (LIBUR_KALENDER_PABRIK_MMDD[mmdd]) {
    return {
      isLibur: true,
      namaHari,
      keterangan: `${namaHari} • ${LIBUR_KALENDER_PABRIK_MMDD[mmdd]}`
    };
  }

  if (dayOfWeek === 0) {
    return {
      isLibur: true,
      namaHari,
      keterangan: `${namaHari} • Libur Mingguan Pabrik`
    };
  }

  return {
    isLibur: false,
    namaHari,
    keterangan: `${namaHari} • Hari Kerja Biasa (Kalender Pabrik)`
  };
};

// Key penyimpanan lokal agar tidak pernah hilang saat refresh / buka tutup browser
const STORAGE_KEYS = {
  PROFIL: 'indofood_lembur_profil_v1',
  LEMBUR_LIST: 'indofood_lembur_list_v1',
  DRAFT_INPUT: 'indofood_lembur_draft_input_v1',
  UI_STATE: 'indofood_lembur_ui_state_v1'
};

export default function App() {
  // State Autentikasi & User
  const [user, setUser] = useState(null);
  const [loadingAuth, setLoadingAuth] = useState(true);
  const [useLocalMode, setUseLocalMode] = useState(!isFirebaseConfigured);
  const [autoSaveStatus, setAutoSaveStatus] = useState('Tersimpan otomatis');
  const isInitialLoadDone = useRef(false);

  // 0. Muat UI State terakhir (Tab aktif & Filter Bulan/Tahun) dari LocalStorage
  const savedUiState = useMemo(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.UI_STATE);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }, []);

  // 0b. Muat Draft Form Input terakhir dari LocalStorage
  const savedDraft = useMemo(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.DRAFT_INPUT);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }, []);

  // 0c. Muat Profil terakhir dari LocalStorage secara instan
  const savedProfilInit = useMemo(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.PROFIL);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }, []);

  // State Navigasi Tab: 'input' | 'rekapan' | 'profil'
  const [activeTab, setActiveTab] = useState(() => savedUiState?.activeTab || 'input');

  // State Profil Karyawan (Langsung terisi dari Auto-Save lokal)
  const [nama, setNama] = useState(() => savedProfilInit?.nama || '');
  const [gapok, setGapok] = useState(() => (savedProfilInit?.gapok ? String(savedProfilInit.gapok) : ''));
  const [savingProfil, setSavingProfil] = useState(false);

  // State Form Input Lembur (Langsung terisi dari Draft Auto-Save jika ada)
  const [tanggal, setTanggal] = useState(() => savedDraft?.tanggal || new Date().toISOString().split('T')[0]);
  const [isLibur, setIsLibur] = useState(() => {
    if (typeof savedDraft?.isLibur === 'boolean') return savedDraft.isLibur;
    const initDate = savedDraft?.tanggal || new Date().toISOString().split('T')[0];
    return cekHariLiburPabrik(initDate).isLibur;
  });
  const [durasi, setDurasi] = useState(() => savedDraft?.durasi || '');
  const [savingLembur, setSavingLembur] = useState(false);

  // State Data Lembur & Filter Rekapan
  const [lemburList, setLemburList] = useState(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.LEMBUR_LIST);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });
  const [selectedMonth, setSelectedMonth] = useState(() => 
    typeof savedUiState?.selectedMonth === 'number' ? savedUiState.selectedMonth : new Date().getMonth()
  );
  const [selectedYear, setSelectedYear] = useState(() => 
    typeof savedUiState?.selectedYear === 'number' ? savedUiState.selectedYear : new Date().getFullYear()
  );

  // State Notifikasi Toast Sederhana
  const [notif, setNotif] = useState(null);

  const showNotif = (pesan, tipe = 'success') => {
    setNotif({ pesan, tipe });
    setTimeout(() => setNotif(null), 3000);
  };

  // ==========================================
  // FITUR AUTO-SAVE (REALTIME KE LOCALSTORAGE & FIREBASE)
  // ==========================================

  // Auto-Save 1: Simpan Tab Aktif & Filter Bulan/Tahun setiap kali berubah
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.UI_STATE, JSON.stringify({
        activeTab,
        selectedMonth,
        selectedYear
      }));
    } catch (e) {
      console.error("Gagal auto-save UI state:", e);
    }
  }, [activeTab, selectedMonth, selectedYear]);

  // Auto-Save 2: Simpan Draft Form Input Lembur saat pengguna mengetik
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.DRAFT_INPUT, JSON.stringify({
        tanggal,
        isLibur,
        durasi
      }));
    } catch (e) {
      console.error("Gagal auto-save draft input:", e);
    }
  }, [tanggal, isLibur, durasi]);

  // Auto-Save 3: Simpan Profil Karyawan (Nama & Gapok) otomatis saat mengetik tanpa harus klik tombol
  useEffect(() => {
    const payload = {
      nama: nama.trim(),
      gapok: Number(gapok) || 0,
      updatedAt: new Date().toISOString()
    };

    // Simpan instan ke LocalStorage
    try {
      localStorage.setItem(STORAGE_KEYS.PROFIL, JSON.stringify(payload));
    } catch (e) {
      console.error("Gagal auto-save profil ke lokal:", e);
    }

    if (!isInitialLoadDone.current) return;

    setAutoSaveStatus('Menyimpan...');
    const timer = setTimeout(async () => {
      if (!useLocalMode && user && db) {
        try {
          const docRef = doc(db, 'users', user.uid);
          await setDoc(docRef, payload, { merge: true });
        } catch (err) {
          console.error("Gagal auto-save profil ke Firestore:", err);
        }
      }
      setAutoSaveStatus('Tersimpan otomatis');
    }, 500);

    return () => clearTimeout(timer);
  }, [nama, gapok, user, useLocalMode]);

  // Auto-Save 4: Sinkronkan daftar lembur ke LocalStorage setiap kali berubah
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.LEMBUR_LIST, JSON.stringify(lemburList));
    } catch (e) {
      console.error("Gagal menyimpan daftar lembur ke lokal:", e);
    }
  }, [lemburList]);

  // 1. Inisialisasi Firebase Anonymous Auth (atau fallback ke Local Mode)
  useEffect(() => {
    if (!isFirebaseConfigured || !auth) {
      setUser({ uid: 'local-user-indofood' });
      setUseLocalMode(true);
      setLoadingAuth(false);
      isInitialLoadDone.current = true;
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser) {
        setUser(currentUser);
        setLoadingAuth(false);
        isInitialLoadDone.current = true;
      } else {
        try {
          await signInAnonymously(auth);
        } catch (error) {
          console.warn("Gagal login anonymous Firebase, beralih ke mode lokal:", error);
          setUser({ uid: 'local-user-indofood' });
          setUseLocalMode(true);
          setLoadingAuth(false);
          isInitialLoadDone.current = true;
        }
      }
    });
    return () => unsubscribe();
  }, []);

  // 2. Load Profil & Listen Data Lembur dari Firestore jika menggunakan Firebase
  useEffect(() => {
    if (!user || useLocalMode || !db) return;

    const fetchProfil = async () => {
      try {
        const docRef = doc(db, 'users', user.uid);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          const data = docSnap.data();
          if (data.nama !== undefined) setNama(data.nama || '');
          if (data.gapok !== undefined) setGapok(data.gapok ? String(data.gapok) : '');
        }
      } catch (err) {
        console.error("Gagal memuat profil dari Firestore:", err);
      }
    };

    fetchProfil();

    const lemburRef = collection(db, 'users', user.uid, 'lembur');
    const q = query(lemburRef, orderBy('tanggal', 'desc'));

    const unsubscribeLembur = onSnapshot(q, (snapshot) => {
      const items = snapshot.docs.map((docSnap) => ({
        id: docSnap.id,
        ...docSnap.data()
      }));
      setLemburList(items);
    }, (error) => {
      console.error("Gagal memuat data lembur:", error);
    });

    return () => unsubscribeLembur();
  }, [user, useLocalMode]);

  // 3. Handler perubahan tanggal (Otomatis menyesuaikan Kalender Pabrik: Minggu atau Tanggal Merah Pabrik seperti 25 Des)
  const handleTanggalChange = (e) => {
    const val = e.target.value;
    setTanggal(val);
    if (val) {
      const infoPabrik = cekHariLiburPabrik(val);
      setIsLibur(infoPabrik.isLibur);
    }
  };

  const infoTanggalPabrik = useMemo(() => cekHariLiburPabrik(tanggal), [tanggal]);

  // Cek apakah tanggal yang dipilih pada form input sudah pernah disimpan sebelumnya
  const entriTanggalDuplikat = useMemo(() => {
    return lemburList.find((item) => item.tanggal === tanggal);
  }, [lemburList, tanggal]);

  // 4. Simpan Profil Manual (Tombol Simpan tetap disediakan untuk konfirmasi visual)
  const handleSimpanProfil = async (e) => {
    e.preventDefault();
    if (!user) return;

    setSavingProfil(true);
    try {
      const payload = {
        nama: nama.trim(),
        gapok: Number(gapok) || 0,
        updatedAt: new Date().toISOString()
      };

      localStorage.setItem(STORAGE_KEYS.PROFIL, JSON.stringify(payload));

      if (!useLocalMode && db) {
        const docRef = doc(db, 'users', user.uid);
        await setDoc(docRef, payload, { merge: true });
      }
      setAutoSaveStatus('Tersimpan otomatis');
      showNotif('Profil berhasil disimpan!');
    } catch (error) {
      console.error("Error simpan profil:", error);
      showNotif('Gagal menyimpan profil.', 'error');
    } finally {
      setSavingProfil(false);
    }
  };

  // 5. Kalkulasi Preview & Simpan Entri Lembur
  const gapokNumber = Number(gapok) || 0;
  const jamEfektifPreview = hitungJamEfektif(durasi, isLibur);
  const estimasiUangPreview = Math.round(jamEfektifPreview * (gapokNumber / 173));

  const handleSimpanLembur = async (e) => {
    e.preventDefault();
    if (!user) return;
    if (gapokNumber <= 0) {
      showNotif('Harap isi Gaji Pokok terlebih dahulu di menu Profil!', 'error');
      return;
    }

    if (entriTanggalDuplikat) {
      showNotif(`Tanggal ${tanggal} sudah pernah diinput! Silakan hapus data sebelumnya di menu Rekapan jika ingin mengganti.`, 'error');
      return;
    }

    const durasiAktual = parseFloat(durasi);
    if (!tanggal || isNaN(durasiAktual) || durasiAktual <= 0) {
      showNotif('Mohon isi tanggal dan durasi lembur dengan benar.', 'error');
      return;
    }

    setSavingLembur(true);
    try {
      const newEntry = {
        tanggal,
        isLibur,
        durasiAktual,
        durasiEfektif: jamEfektifPreview,
        estimasiUang: estimasiUangPreview,
        createdAt: new Date().toISOString()
      };

      if (useLocalMode || !db) {
        const entryWithId = { id: Date.now().toString(), ...newEntry };
        const updated = [entryWithId, ...lemburList].sort((a, b) => (b.tanggal > a.tanggal ? 1 : -1));
        setLemburList(updated);
        localStorage.setItem(STORAGE_KEYS.LEMBUR_LIST, JSON.stringify(updated));
      } else {
        const lemburRef = collection(db, 'users', user.uid, 'lembur');
        await addDoc(lemburRef, newEntry);
      }

      setDurasi('');
      showNotif('Data lembur berhasil disimpan!');
    } catch (error) {
      console.error("Error simpan lembur:", error);
      showNotif('Gagal menyimpan data lembur.', 'error');
    } finally {
      setSavingLembur(false);
    }
  };

  // Hapus entri lembur
  const handleHapusLembur = async (id) => {
    if (!user) return;
    try {
      if (useLocalMode || !db) {
        const updated = lemburList.filter((item) => item.id !== id);
        setLemburList(updated);
        localStorage.setItem(STORAGE_KEYS.LEMBUR_LIST, JSON.stringify(updated));
      } else {
        await deleteDoc(doc(db, 'users', user.uid, 'lembur', id));
      }
      showNotif('Data lembur dihapus.');
    } catch (error) {
      console.error("Gagal menghapus:", error);
      showNotif('Gagal menghapus data.', 'error');
    }
  };

  // 6. Filter Rekapan Berdasarkan Kalender Bulanan (Tanggal 1 s/d Akhir Bulan terpilih)
  const { filteredLembur, sortedForPrint, periodeLabel, totalAktual, totalEfektif, totalRupiah } = useMemo(() => {
    // Tanggal mulai: Tanggal 1 pada bulan terpilih
    const startDateObj = new Date(selectedYear, selectedMonth, 1);
    // Tanggal selesai: Hari terakhir pada bulan terpilih (day 0 di bulan berikutnya)
    const endDateObj = new Date(selectedYear, selectedMonth + 1, 0);

    const formatYMD = (d) => {
      const yr = d.getFullYear();
      const mo = String(d.getMonth() + 1).padStart(2, '0');
      const da = String(d.getDate()).padStart(2, '0');
      return `${yr}-${mo}-${da}`;
    };

    const startStr = formatYMD(startDateObj);
    const endStr = formatYMD(endDateObj);

    const filtered = lemburList.filter((item) => {
      return item.tanggal >= startStr && item.tanggal <= endStr;
    });

    // Urutkan kronologis dari tanggal awal ke akhir untuk laporan cetak PDF
    const chronological = [...filtered].sort((a, b) => (a.tanggal > b.tanggal ? 1 : -1));

    const tAktual = filtered.reduce((acc, curr) => acc + (Number(curr.durasiAktual) || 0), 0);
    const tEfektif = filtered.reduce((acc, curr) => acc + (Number(curr.durasiEfektif) || 0), 0);
    const tRupiah = filtered.reduce((acc, curr) => acc + (Number(curr.estimasiUang) || 0), 0);

    const labelStart = `1 ${NAMA_BULAN[startDateObj.getMonth()]} ${startDateObj.getFullYear()}`;
    const labelEnd = `${endDateObj.getDate()} ${NAMA_BULAN[endDateObj.getMonth()]} ${endDateObj.getFullYear()}`;

    return {
      filteredLembur: filtered,
      sortedForPrint: chronological,
      periodeLabel: `${labelStart} - ${labelEnd}`,
      totalAktual: Number(tAktual.toFixed(2)),
      totalEfektif: Number(tEfektif.toFixed(2)),
      totalRupiah: tRupiah
    };
  }, [lemburList, selectedMonth, selectedYear]);

  // 7. Handler Cetak / Simpan PDF Laporan untuk HRD
  const handlePrintPDF = () => {
    const originalTitle = document.title;
    const cleanNama = (nama.trim() || 'Karyawan').replace(/\s+/g, '_');
    const namaBulan = NAMA_BULAN[selectedMonth];
    document.title = `Laporan_Lembur_${cleanNama}_${namaBulan}_${selectedYear}`;
    window.print();
    setTimeout(() => {
      document.title = originalTitle;
    }, 1000);
  };

  if (loadingAuth) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center">
        <div className="text-blue-700 font-semibold animate-pulse">Memuat aplikasi...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-200 print:bg-white flex justify-center">
      {/* Container Mobile (max-w: 400px), disembunyikan saat cetak PDF */}
      <div className="w-full max-w-[400px] bg-slate-50 min-h-screen flex flex-col relative shadow-xl pb-20 print:hidden">
        
        {/* Notifikasi Toast */}
        {notif && (
          <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-lg shadow-lg text-white text-sm font-medium flex items-center gap-2 transition-all max-w-[360px] w-full print:hidden ${
            notif.tipe === 'error' ? 'bg-red-600' : 'bg-emerald-600'
          }`}>
            {notif.tipe === 'error' ? <AlertCircle size={18} /> : <CheckCircle2 size={18} />}
            <span>{notif.pesan}</span>
          </div>
        )}

        {/* ================= HEADER ================= */}
        <header className="bg-white border-b-4 border-blue-700 px-4 pt-3 pb-3 sticky top-0 z-20 shadow-sm print:static">
          <div className="flex items-center justify-between gap-2">
            {/* Sisi Kiri (Lingkaran Merah): OTW-In Efek Typography 3D Gradasi & Outline dibuat Lebih Besar */}
            <div className="flex flex-col text-left">
              <span className="otw-badge-title text-2xl font-black italic tracking-wide leading-none select-none">
                OTW-In
              </span>
              <span className="text-[10px] font-bold text-emerald-700 tracking-tight leading-tight mt-1 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block animate-pulse"></span>
                Overtime Tracking Web Instan
              </span>
            </div>

            {/* Sisi Kanan (Lingkaran Hijau): Logo Indofood CBP Dibuat Lebih Kecil & Manis */}
            <div className="flex items-center justify-end">
              <img 
                src="image_f90204.png" 
                alt="Indofood CBP" 
                className="h-5 max-w-[100px] object-contain"
              />
            </div>
          </div>

          <div className="mt-2.5 bg-blue-600 text-white px-4 py-2 rounded-lg shadow-inner text-center font-semibold text-sm tracking-wide">
            Halo, {nama.trim() ? nama : 'Karyawan'}
          </div>
          <div className="mt-1.5 flex items-center justify-center gap-1 text-[11px] text-emerald-600 font-medium print:hidden">
            <CheckCircle2 size={13} />
            <span>{autoSaveStatus}</span>
          </div>
        </header>

        {/* ================= MAIN CONTENT ================= */}
        <main className="flex-1 p-4">
          
          {/* ---------- TAB 1: INPUT LEMBUR ---------- */}
          {activeTab === 'input' && (
            <div className="space-y-4">
              <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                <PlusCircle className="text-blue-600" size={20} />
                Entri Data Lembur
              </h2>

              {gapokNumber <= 0 ? (
                <div className="bg-amber-50 border border-amber-300 rounded-xl p-4 text-amber-800 space-y-3">
                  <div className="flex items-start gap-3">
                    <AlertCircle className="text-amber-600 shrink-0 mt-0.5" size={22} />
                    <div className="text-sm">
                      <p className="font-bold">Gaji Pokok Belum Diisi!</p>
                      <p className="mt-1">
                        Anda tidak dapat menginput data lembur sebelum mengisi Gaji Pokok. Silakan lengkapi di menu <strong>Profil</strong>.
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => setActiveTab('profil')}
                    className="w-full bg-amber-600 hover:bg-amber-700 text-white font-semibold py-2 px-4 rounded-lg text-sm transition cursor-pointer"
                  >
                    Buka Menu Profil
                  </button>
                </div>
              ) : (
                <form onSubmit={handleSimpanLembur} className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 space-y-4">
                  {/* Input Tanggal */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 uppercase mb-1">
                      Tanggal Lembur (Kalender Pabrik)
                    </label>
                    <div className="relative">
                      <input
                        type="date"
                        value={tanggal}
                        onChange={handleTanggalChange}
                        required
                        className={`w-full border rounded-lg px-3 py-2.5 text-sm text-slate-800 focus:outline-none focus:ring-2 ${
                          entriTanggalDuplikat 
                            ? 'border-red-500 focus:ring-red-500 bg-red-50/40' 
                            : 'border-slate-300 focus:ring-blue-500'
                        }`}
                      />
                    </div>
                    {entriTanggalDuplikat ? (
                      <div className="mt-2 bg-red-50 border border-red-200 rounded-lg p-2.5 text-xs text-red-700 flex items-start gap-2">
                        <AlertCircle className="shrink-0 text-red-600 mt-0.5" size={16} />
                        <div>
                          <p className="font-bold">Tanggal ini sudah ada dalam rekapan!</p>
                          <p className="mt-0.5 text-[11px] text-red-600 leading-relaxed">
                            Sudah ada input lembur <strong>{entriTanggalDuplikat.durasiAktual} jam</strong> pada tanggal <strong>{tanggal}</strong>. Untuk mengubah atau menginput ulang, silakan hapus data tanggal ini terlebih dahulu di menu <strong>Rekapan</strong>.
                          </p>
                        </div>
                      </div>
                    ) : tanggal ? (
                      <p className={`text-xs mt-1.5 font-medium ${
                        infoTanggalPabrik.isLibur ? 'text-red-600' : 'text-emerald-700'
                      }`}>
                        Status Kalender Pabrik: <strong>{infoTanggalPabrik.keterangan}</strong>
                      </p>
                    ) : null}
                  </div>

                  {/* Checkbox Hari Libur (Disembunyikan dari UI, tetapi fungsi logika Kalender Pabrik tetap aktif 100%) */}
                  <input
                    type="checkbox"
                    checked={isLibur}
                    onChange={(e) => setIsLibur(e.target.checked)}
                    className="hidden"
                    tabIndex={-1}
                    aria-hidden="true"
                  />

                  {/* Input Durasi */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 uppercase mb-1">
                      Durasi Lembur (Jam)
                    </label>
                    <input
                      type="number"
                      step="0.5"
                      min="0.5"
                      max="24"
                      placeholder="Contoh: 3 atau 3.5"
                      value={durasi}
                      onChange={(e) => setDurasi(e.target.value)}
                      required
                      className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  {/* Kalkulasi Preview Realtime */}
                  <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 space-y-1.5">
                    <div className="flex justify-between text-xs text-slate-600">
                      <span>Kategori:</span>
                      <span className="font-semibold text-blue-700">
                        {isLibur ? 'Lembur Hari Libur' : 'Lembur Hari Biasa'}
                      </span>
                    </div>
                    <div className="flex justify-between text-xs text-slate-600">
                      <span>Jam Efektif (Terhitung):</span>
                      <span className="font-bold text-slate-800">{jamEfektifPreview} Jam</span>
                    </div>
                    <div className="flex justify-between text-sm font-bold text-blue-800 pt-1 border-t border-blue-200">
                      <span>Estimasi Upah:</span>
                      <span>{formatRupiah(estimasiUangPreview)}</span>
                    </div>
                  </div>

                  {/* Tombol Simpan */}
                  <button
                    type="submit"
                    disabled={savingLembur || Boolean(entriTanggalDuplikat)}
                    className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed disabled:text-slate-500 text-white font-semibold py-2.5 rounded-lg shadow transition text-sm cursor-pointer"
                  >
                    {savingLembur 
                      ? 'Menyimpan...' 
                      : entriTanggalDuplikat 
                        ? 'Tanggal Sudah Diinput (Terkunci)' 
                        : 'Simpan Data Lembur'}
                  </button>
                </form>
              )}
            </div>
          )}

          {/* ---------- TAB 2: REKAPAN ---------- */}
          {activeTab === 'rekapan' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                  <FileText className="text-blue-600" size={20} />
                  Rekapan Lembur
                </h2>
                <button
                  onClick={handlePrintPDF}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold px-3 py-2 rounded-lg shadow-sm flex items-center gap-1.5 transition cursor-pointer print:hidden"
                >
                  <Printer size={15} />
                  Cetak PDF
                </button>
              </div>

              {/* Filter Bulan & Tahun */}
              <div className="bg-white p-3 rounded-xl shadow-sm border border-slate-200 space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-500 uppercase mb-1">
                      Bulan
                    </label>
                    <select
                      value={selectedMonth}
                      onChange={(e) => setSelectedMonth(Number(e.target.value))}
                      className="w-full border border-slate-300 rounded-lg px-2.5 py-2 text-sm text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      {NAMA_BULAN.map((bln, idx) => (
                        <option key={idx} value={idx}>{bln}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-500 uppercase mb-1">
                      Tahun
                    </label>
                    <select
                      value={selectedYear}
                      onChange={(e) => setSelectedYear(Number(e.target.value))}
                      className="w-full border border-slate-300 rounded-lg px-2.5 py-2 text-sm text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      {[selectedYear - 1, selectedYear, selectedYear + 1].map((yr) => (
                        <option key={yr} value={yr}>{yr}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="text-center bg-slate-100 py-1.5 px-2 rounded text-xs text-slate-600 font-medium">
                  Periode Cut-Off: <span className="font-bold text-slate-800">{periodeLabel}</span>
                </div>
              </div>

              {/* Card Total Akumulasi (Kompatibel untuk Safari iOS & Semua Browser HP) */}
              <div className="bg-blue-600 [background-image:linear-gradient(135deg,#2563eb,#1d4ed8)] text-white p-4 rounded-xl shadow-md space-y-3">
                <div className="flex items-center justify-between border-b border-blue-400/50 pb-2">
                  <span className="text-xs uppercase tracking-wider text-blue-100 font-semibold">
                    Total Estimasi Pendapatan
                  </span>
                  <Wallet size={18} className="text-blue-200" />
                </div>
                <div className="text-2xl font-extrabold tracking-tight text-white">
                  {formatRupiah(totalRupiah)}
                </div>
                <div className="grid grid-cols-2 gap-2 pt-1 border-t border-blue-400/50 text-xs">
                  <div className="bg-blue-800/80 p-2 rounded-lg border border-blue-400/30">
                    <span className="text-blue-100 block text-[11px]">Total Jam Aktual</span>
                    <span className="text-base font-bold text-white">{totalAktual} Jam</span>
                  </div>
                  <div className="bg-blue-800/80 p-2 rounded-lg border border-blue-400/30">
                    <span className="text-blue-100 block text-[11px]">Total Jam Efektif</span>
                    <span className="text-base font-bold text-white">{totalEfektif} Jam</span>
                  </div>
                </div>
              </div>

              {/* Daftar Riwayat Lembur */}
              <div className="space-y-2.5">
                <h3 className="text-xs font-bold uppercase text-slate-500 tracking-wider">
                  Rincian Entri ({filteredLembur.length})
                </h3>

                {filteredLembur.length === 0 ? (
                  <div className="bg-white border border-slate-200 rounded-xl p-6 text-center text-slate-400 text-sm">
                    Belum ada catatan lembur pada periode ini.
                  </div>
                ) : (
                  filteredLembur.map((item) => (
                    <div
                      key={item.id}
                      className="bg-white border border-slate-200 rounded-xl p-3 shadow-sm flex items-center justify-between gap-2"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-sm text-slate-800 flex items-center gap-1">
                            <Calendar size={14} className="text-blue-600" />
                            {item.tanggal}
                          </span>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                            item.isLibur 
                              ? 'bg-red-100 text-red-700' 
                              : 'bg-emerald-100 text-emerald-700'
                          }`}>
                            {item.isLibur ? 'Hari Libur' : 'Hari Biasa'}
                          </span>
                        </div>
                        <div className="text-xs text-slate-500 flex items-center gap-3">
                          <span className="flex items-center gap-1">
                            <Clock size={12} /> Aktual: <strong>{item.durasiAktual}j</strong>
                          </span>
                          <span>•</span>
                          <span>Efektif: <strong>{item.durasiEfektif}j</strong></span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <div className="text-right">
                          <span className="text-sm font-bold text-blue-700 block">
                            {formatRupiah(item.estimasiUang)}
                          </span>
                        </div>
                        <button
                          onClick={() => handleHapusLembur(item.id)}
                          title="Hapus"
                          className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition cursor-pointer print:hidden"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* ---------- TAB 3: PROFIL ---------- */}
          {activeTab === 'profil' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                  <User className="text-blue-600" size={20} />
                  Profil Karyawan
                </h2>
                <span className="text-xs text-emerald-600 font-medium flex items-center gap-1 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200">
                  <CheckCircle2 size={14} /> Auto-Save Aktif
                </span>
              </div>

              <form onSubmit={handleSimpanProfil} className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 uppercase mb-1">
                    Nama Karyawan
                  </label>
                  <input
                    type="text"
                    placeholder="Masukkan nama lengkap"
                    value={nama}
                    onChange={(e) => setNama(e.target.value)}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <p className="text-[11px] text-slate-400 mt-1">
                    Otomatis tersimpan saat Anda mengetik.
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 uppercase mb-1">
                    Gaji Pokok (Rp)
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="Contoh: 4.500.000"
                    value={formatRibuan(gapok)}
                    onChange={(e) => {
                      const digitsOnly = e.target.value.replace(/\D/g, '');
                      setGapok(digitsOnly);
                    }}
                    required
                    className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
                  />
                  {gapokNumber > 0 && (
                    <p className="text-xs text-slate-500 mt-1">
                      Upah lembur per jam efektif (Gapok / 173):{' '}
                      <strong className="text-slate-700">
                        {formatRupiah(Math.round(gapokNumber / 173))}
                      </strong>
                    </p>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={savingProfil}
                  className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-semibold py-2.5 rounded-lg shadow transition text-sm cursor-pointer"
                >
                  {savingProfil ? 'Menyimpan...' : 'Simpan Profil'}
                </button>
              </form>
            </div>
          )}

        </main>

        {/* ================= AUTHOR FOOTER ================= */}
        <footer className="text-center py-3 px-4 text-xs text-slate-400 border-t border-slate-200/70 bg-slate-50">
          Author by <span className="font-semibold text-slate-600">Muhammad Padli Azhim</span>
        </footer>

        {/* ================= BOTTOM NAVIGATION ================= */}
        <nav className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[400px] bg-white border-t border-slate-200 flex justify-around items-center py-2 z-30 shadow-lg print:hidden">
          <button
            onClick={() => setActiveTab('input')}
            className={`flex flex-col items-center gap-1 px-4 py-1 rounded-lg transition cursor-pointer ${
              activeTab === 'input' ? 'text-blue-600 font-bold' : 'text-slate-400 hover:text-slate-600'
            }`}
          >
            <PlusCircle size={20} />
            <span className="text-xs">Input</span>
          </button>

          <button
            onClick={() => setActiveTab('rekapan')}
            className={`flex flex-col items-center gap-1 px-4 py-1 rounded-lg transition cursor-pointer ${
              activeTab === 'rekapan' ? 'text-blue-600 font-bold' : 'text-slate-400 hover:text-slate-600'
            }`}
          >
            <FileText size={20} />
            <span className="text-xs">Rekapan</span>
          </button>

          <button
            onClick={() => setActiveTab('profil')}
            className={`flex flex-col items-center gap-1 px-4 py-1 rounded-lg transition relative cursor-pointer ${
              activeTab === 'profil' ? 'text-blue-600 font-bold' : 'text-slate-400 hover:text-slate-600'
            }`}
          >
            <User size={20} />
            <span className="text-xs">Profil</span>
            {gapokNumber <= 0 && (
              <span className="w-2.5 h-2.5 bg-red-500 rounded-full absolute top-1 right-3 animate-ping" />
            )}
          </button>
        </nav>

      </div>

      {/* =====================================================================
          TAMPILAN CETAK PDF (A4 Landscape Compact - Muat 1 Halaman Penuh 31 Hari)
         ===================================================================== */}
      <div className="hidden print:block w-full max-w-none mx-auto px-2 py-1 bg-white text-slate-800 font-sans">
        {/* Header Banner Compact */}
        <div className="flex items-center justify-between border-b-2 border-blue-700 pb-2 mb-2.5">
          <div className="flex items-center gap-3">
            <img
              src="image_f90204.png"
              alt="Indofood CBP"
              className="h-8 object-contain"
            />
            <div className="border-l-2 border-slate-200 pl-3">
              <h1 className="text-sm font-extrabold text-slate-900 tracking-tight leading-tight">
                REKAPAN LEMBURAN KARYAWAN
              </h1>
              <p className="text-[10px] text-slate-500 font-medium">
                Periode Cut-Off: <span className="text-blue-700 font-bold">{periodeLabel}</span>
              </p>
            </div>
          </div>
          <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-1 text-right">
            <span className="text-[9px] font-bold uppercase tracking-wider text-blue-600 block leading-none">
              Bulan Rekapan
            </span>
            <span className="text-xs font-extrabold text-blue-900">
              {NAMA_BULAN[selectedMonth]} {selectedYear}
            </span>
          </div>
        </div>

        {/* Kartu Ringkasan Informasi & Total (Compact 4 Kolom) */}
        <div className="grid grid-cols-4 gap-2 mb-2.5">
          <div className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 flex items-center justify-between">
            <div>
              <span className="text-[9px] font-bold uppercase text-slate-400 block leading-none">
                Nama Karyawan
              </span>
              <span className="text-xs font-bold text-slate-800 mt-0.5 block truncate">
                {nama.trim() || 'Karyawan'}
              </span>
            </div>
            <div className="text-right">
              <span className="text-[9px] text-slate-400 block leading-none">Gaji Pokok</span>
              <span className="text-[11px] font-semibold text-slate-700 mt-0.5 block">
                {formatRupiah(gapokNumber)}
              </span>
            </div>
          </div>

          <div className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 flex items-center justify-between">
            <div>
              <span className="text-[9px] font-bold uppercase text-slate-400 block leading-none">
                Total Jam Aktual
              </span>
              <span className="text-xs font-extrabold text-slate-800 mt-0.5 block">
                {totalAktual} Jam
              </span>
            </div>
            <span className="text-[10px] bg-slate-200/70 text-slate-700 font-semibold px-2 py-0.5 rounded-full">
              {sortedForPrint.length} Hari
            </span>
          </div>

          <div className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 flex items-center justify-between">
            <div>
              <span className="text-[9px] font-bold uppercase text-slate-400 block leading-none">
                Total Jam Efektif
              </span>
              <span className="text-xs font-extrabold text-blue-700 mt-0.5 block">
                {totalEfektif} Jam
              </span>
            </div>
            <div className="text-right">
              <span className="text-[9px] text-slate-400 block leading-none">Tarif / Jam</span>
              <span className="text-[10px] font-semibold text-slate-600 mt-0.5 block">
                {formatRupiah(Math.round(gapokNumber / 173))}
              </span>
            </div>
          </div>

          <div className="bg-gradient-to-r from-blue-600 to-blue-800 text-white rounded-lg px-3 py-1.5 flex items-center justify-between shadow-xs">
            <div>
              <span className="text-[9px] font-bold uppercase text-blue-100 block leading-none">
                Total Estimasi Lembur
              </span>
              <span className="text-sm font-extrabold mt-0.5 block">
                {formatRupiah(totalRupiah)}
              </span>
            </div>
            <Wallet size={16} className="text-blue-200 shrink-0" />
          </div>
        </div>

        {/* Tabel Rekapan Lembur Compact (1 Kolom jika <= 15 hari, Otomatis 2 Kolom Berdampingan jika > 15 hari agar selalu muat 1 halaman) */}
        {sortedForPrint.length === 0 ? (
          <div className="rounded-lg border border-slate-300 py-8 text-center text-xs text-slate-400 italic">
            Belum ada data lembur pada periode {periodeLabel}.
          </div>
        ) : sortedForPrint.length <= 15 ? (
          <div className="rounded-lg overflow-hidden border border-slate-300">
            <table className="w-full border-collapse text-[10px]">
              <thead>
                <tr className="bg-blue-700 text-white uppercase tracking-wider text-[9px]">
                  <th className="py-1.5 px-2 text-center w-8 font-bold">No</th>
                  <th className="py-1.5 px-2.5 text-left font-bold">Tanggal</th>
                  <th className="py-1.5 px-2.5 text-left font-bold">Hari</th>
                  <th className="py-1.5 px-2.5 text-center font-bold">Kategori Kalender Pabrik</th>
                  <th className="py-1.5 px-2.5 text-center font-bold">Jam Aktual</th>
                  <th className="py-1.5 px-2.5 text-center font-bold">Jam Efektif</th>
                  <th className="py-1.5 px-2.5 text-right font-bold">Estimasi Upah</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {sortedForPrint.map((item, idx) => {
                  const infoHari = cekHariLiburPabrik(item.tanggal);
                  return (
                    <tr key={item.id} className="even:bg-slate-50">
                      <td className="py-1 px-2 text-center text-slate-500 font-medium">{idx + 1}</td>
                      <td className="py-1 px-2.5 font-bold text-slate-800">{item.tanggal}</td>
                      <td className="py-1 px-2.5 text-slate-700 font-medium">{infoHari.namaHari}</td>
                      <td className="py-1 px-2.5 text-center">
                        <span className={`inline-block px-2 py-0.2 rounded-full text-[9px] font-bold ${
                          item.isLibur
                            ? 'bg-red-100 text-red-700 border border-red-200'
                            : 'bg-emerald-100 text-emerald-700 border border-emerald-200'
                        }`}>
                          {item.isLibur ? 'Hari Libur' : 'Hari Biasa'}
                        </span>
                      </td>
                      <td className="py-1 px-2.5 text-center font-semibold text-slate-700">{item.durasiAktual}j</td>
                      <td className="py-1 px-2.5 text-center font-bold text-blue-700">{item.durasiEfektif}j</td>
                      <td className="py-1 px-2.5 text-right font-bold text-slate-900">{formatRupiah(item.estimasiUang)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-blue-50 border-t-2 border-blue-300 font-extrabold text-slate-900 text-[10px]">
                  <td colSpan={4} className="py-1.5 px-2.5 text-right uppercase text-blue-900">
                    Total Keseluruhan
                  </td>
                  <td className="py-1.5 px-2.5 text-center text-slate-800">{totalAktual} Jam</td>
                  <td className="py-1.5 px-2.5 text-center text-blue-800">{totalEfektif} Jam</td>
                  <td className="py-1.5 px-2.5 text-right text-blue-800 text-xs">{formatRupiah(totalRupiah)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        ) : (
          /* Mode 2 Tabel Berdampingan (Kiri: No 1-16, Kanan: No 17-31) agar 31 hari muat 1 halaman Landscape */
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2.5 items-start">
              {[
                sortedForPrint.slice(0, Math.ceil(sortedForPrint.length / 2)),
                sortedForPrint.slice(Math.ceil(sortedForPrint.length / 2))
              ].map((chunk, colIdx) => {
                const startNum = colIdx === 0 ? 1 : Math.ceil(sortedForPrint.length / 2) + 1;
                return (
                  <div key={colIdx} className="rounded-lg overflow-hidden border border-slate-300">
                    <table className="w-full border-collapse text-[9.5px]">
                      <thead>
                        <tr className="bg-blue-700 text-white uppercase tracking-wider text-[8.5px]">
                          <th className="py-1 px-1.5 text-center w-6 font-bold">No</th>
                          <th className="py-1 px-2 text-left font-bold">Tanggal</th>
                          <th className="py-1 px-1.5 text-left font-bold">Hari</th>
                          <th className="py-1 px-1.5 text-center font-bold">Status</th>
                          <th className="py-1 px-1.5 text-center font-bold">Aktual</th>
                          <th className="py-1 px-1.5 text-center font-bold">Efektif</th>
                          <th className="py-1 px-2 text-right font-bold">Estimasi Upah</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {chunk.map((item, idx) => {
                          const infoHari = cekHariLiburPabrik(item.tanggal);
                          return (
                            <tr key={item.id} className="even:bg-slate-50">
                              <td className="py-0.5 px-1.5 text-center text-slate-500 font-medium">
                                {startNum + idx}
                              </td>
                              <td className="py-0.5 px-2 font-bold text-slate-800">{item.tanggal}</td>
                              <td className="py-0.5 px-1.5 text-slate-700 font-medium">{infoHari.namaHari}</td>
                              <td className="py-0.5 px-1.5 text-center">
                                <span className={`inline-block px-1.5 rounded-full text-[8px] font-bold ${
                                  item.isLibur
                                    ? 'bg-red-100 text-red-700'
                                    : 'bg-emerald-100 text-emerald-700'
                                }`}>
                                  {item.isLibur ? 'Libur' : 'Biasa'}
                                </span>
                              </td>
                              <td className="py-0.5 px-1.5 text-center font-semibold text-slate-700">
                                {item.durasiAktual}j
                              </td>
                              <td className="py-0.5 px-1.5 text-center font-bold text-blue-700">
                                {item.durasiEfektif}j
                              </td>
                              <td className="py-0.5 px-2 text-right font-bold text-slate-900">
                                {formatRupiah(item.estimasiUang)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                );
              })}
            </div>

            {/* Baris Total Keseluruhan di Bawah Kedua Tabel */}
            <div className="bg-blue-50 border-2 border-blue-300 rounded-lg px-4 py-1.5 flex items-center justify-between text-xs font-extrabold text-blue-900">
              <span className="uppercase tracking-wide">
                Total Akumulasi Periode ({sortedForPrint.length} Hari Lembur)
              </span>
              <div className="flex items-center gap-6">
                <span>Total Jam Aktual: <strong className="text-slate-900">{totalAktual} Jam</strong></span>
                <span>Total Jam Efektif: <strong className="text-blue-800">{totalEfektif} Jam</strong></span>
                <span className="text-sm bg-blue-700 text-white px-3 py-0.5 rounded-md">
                  Total Upah: {formatRupiah(totalRupiah)}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Footer Kecil */}
        <div className="mt-2 flex justify-between items-center text-[9px] text-slate-400">
          <span>Dicetak pada: {new Date().toLocaleString('id-ID')}</span>
          <span>Author by Muhammad Padli Azhim</span>
        </div>
      </div>
    </div>
  );
}
