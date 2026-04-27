import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  auth, 
  db, 
  googleProvider, 
  signInWithPopup, 
  signOut, 
  onAuthStateChanged, 
  collection, 
  addDoc, 
  query, 
  where, 
  orderBy, 
  onSnapshot, 
  serverTimestamp, 
  doc, 
  setDoc,
  User
} from './firebase';
import { 
  Upload, 
  History, 
  Settings, 
  LogOut, 
  Download, 
  Copy, 
  Check, 
  Image as ImageIcon, 
  Loader2, 
  Plus, 
  X,
  LayoutDashboard,
  Sparkles,
  Search,
  ChevronRight,
  User as UserIcon
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from './lib/utils';
import { generateMetadata } from './services/gemini';
import { generateMetadataGroq } from './services/groq';
import { MetadataResult, HistoryItem } from './types';
import confetti from 'canvas-confetti';
import { Key, Cpu, FileText } from 'lucide-react';

// --- Components ---

const SidebarItem = ({ icon: Icon, label, active, onClick }: { icon: any, label: string, active?: boolean, onClick: () => void }) => (
  <button
    onClick={onClick}
    className={cn(
      "flex items-center gap-3 px-4 py-3 w-full rounded-xl transition-all duration-200 group",
      active 
        ? "bg-blue-600 text-white shadow-lg shadow-blue-200" 
        : "text-slate-500 hover:bg-slate-100 hover:text-slate-900"
    )}
  >
    <Icon size={20} className={cn("transition-transform duration-200 group-hover:scale-110", active ? "text-white" : "text-slate-400")} />
    <span className="font-medium">{label}</span>
  </button>
);

const Button = ({ children, className, variant = 'primary', isLoading, ...props }: any) => {
  const variants = {
    primary: "bg-blue-600 text-white hover:bg-blue-700 shadow-md hover:shadow-lg",
    secondary: "bg-white text-slate-900 border border-slate-200 hover:bg-slate-50",
    ghost: "text-slate-500 hover:bg-slate-100",
    danger: "bg-red-50 text-red-600 hover:bg-red-100"
  };

  return (
    <button
      disabled={isLoading}
      className={cn(
        "flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl font-semibold transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed active:scale-95",
        variants[variant as keyof typeof variants],
        className
      )}
      {...props}
    >
      {isLoading ? <Loader2 size={18} className="animate-spin" /> : children}
    </button>
  );
};

const Card = ({ children, className, onClick }: { children: React.ReactNode, className?: string, onClick?: () => void }) => (
  <div 
    onClick={onClick}
    className={cn("bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden", className)}
  >
    {children}
  </div>
);

// --- Main App ---

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'generate' | 'history' | 'settings'>('generate');
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string>("image.jpg");
  const [isGenerating, setIsGenerating] = useState(false);
  const [result, setResult] = useState<MetadataResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [copying, setCopying] = useState(false);
  const [titleCopying, setTitleCopying] = useState(false);
  const [titleWordCount, setTitleWordCount] = useState(15);
  const [keywordCount, setKeywordCount] = useState(45);
  const [apiProvider, setApiProvider] = useState<'gemini' | 'groq'>('gemini');
  const [groqKeys, setGroqKeys] = useState<string[]>(() => {
    const saved = localStorage.getItem('groq_keys');
    return saved ? JSON.parse(saved) : [];
  });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const keyFileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    localStorage.setItem('groq_keys', JSON.stringify(groqKeys));
  }, [groqKeys]);

  // Auth
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        // Sync user to Firestore
        await setDoc(doc(db, 'users', u.uid), {
          uid: u.uid,
          email: u.email,
          displayName: u.displayName,
          photoURL: u.photoURL,
          createdAt: serverTimestamp()
        }, { merge: true });
      }
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  // History
  useEffect(() => {
    if (!user) return;
    const q = query(
      collection(db, 'history'),
      where('userId', '==', user.uid),
      orderBy('createdAt', 'desc')
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as HistoryItem));
      setHistory(items);
    });
    return unsubscribe;
  }, [user]);

  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      console.error("Login failed", error);
    }
  };

  const handleLogout = () => signOut(auth);

  const onKeyFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const text = event.target?.result as string;
        const keys = text.split(/\r?\n/).map(k => k.trim()).filter(k => k.length > 0);
        setGroqKeys(keys);
        alert(`Successfully loaded ${keys.length} API keys.`);
      };
      reader.readAsText(file);
    }
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setFileName(file.name);
      const reader = new FileReader();
      reader.onloadend = () => {
        setSelectedImage(reader.result as string);
        setResult(null);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleGenerate = async () => {
    if (!selectedImage || !user) return;
    if (apiProvider === 'groq' && groqKeys.length === 0) {
      setError("Please add Groq API keys in Settings tab first.");
      setActiveTab('settings');
      return;
    }

    setIsGenerating(true);
    setError(null);
    try {
      const data = apiProvider === 'gemini' 
        ? await generateMetadata(selectedImage, titleWordCount, keywordCount)
        : await generateMetadataGroq(selectedImage, groqKeys, titleWordCount, keywordCount);
      
      setResult(data);
      
      // Save to history
      await addDoc(collection(db, 'history'), {
        userId: user.uid,
        imageUrl: selectedImage,
        title: data.title,
        keywords: data.keywords,
        createdAt: serverTimestamp()
      });

      confetti({
        particleCount: 100,
        spread: 70,
        origin: { y: 0.6 }
      });
    } catch (err: any) {
      console.error("Generation failed", err);
      setError(err.message || "Failed to generate metadata. Please try again.");
    } finally {
      setIsGenerating(false);
    }
  };

  const downloadCSV = () => {
    if (!result) return;
    // Adobe Stock CSV Format: Filename,Title,Keywords
    const header = "Filename,Title,Keywords";
    const keywordsStr = result.keywords.join(",");
    const csvContent = `${header}\n"${fileName}","${result.title.replace(/"/g, '""')}","${keywordsStr.replace(/"/g, '""')}"`;
    
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName.replace(/\.[^/.]+$/, "") + "_metadata.csv";
    a.click();
  };

  const copyTitle = () => {
    if (!result) return;
    navigator.clipboard.writeText(result.title);
    setTitleCopying(true);
    setTimeout(() => setTitleCopying(false), 2000);
  };

  const copyToClipboard = () => {
    if (!result) return;
    navigator.clipboard.writeText(result.keywords.join(", "));
    setCopying(true);
    setTimeout(() => setCopying(false), 2000);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="animate-spin text-blue-600" size={40} />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
        <Card className="max-w-md w-full p-8 text-center space-y-6">
          <div className="w-20 h-20 bg-blue-100 text-blue-600 rounded-3xl flex items-center justify-center mx-auto mb-4">
            <Sparkles size={40} />
          </div>
          <div className="space-y-2">
            <h1 className="text-3xl font-bold text-slate-900">Adobe SEO AI</h1>
            <p className="text-slate-500">Generate high-converting titles and keywords for your stock images in seconds.</p>
          </div>
          <Button onClick={handleLogin} className="w-full py-4 text-lg">
            <UserIcon size={20} />
            Sign in with Google
          </Button>
          <p className="text-xs text-slate-400">By signing in, you agree to our Terms of Service.</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Sidebar */}
      <aside className="w-72 bg-white border-r border-slate-200 p-6 flex flex-col gap-8 hidden lg:flex">
        <div className="flex items-center gap-3 px-2">
          <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-blue-200">
            <Sparkles size={22} />
          </div>
          <span className="text-xl font-bold text-slate-900">StockSEO</span>
        </div>

        <nav className="flex-1 space-y-2">
          <SidebarItem 
            icon={LayoutDashboard} 
            label="Generate" 
            active={activeTab === 'generate'} 
            onClick={() => setActiveTab('generate')} 
          />
          <SidebarItem 
            icon={History} 
            label="History" 
            active={activeTab === 'history'} 
            onClick={() => setActiveTab('history')} 
          />
          <SidebarItem 
            icon={Settings} 
            label="Settings" 
            active={activeTab === 'settings'} 
            onClick={() => setActiveTab('settings')} 
          />
        </nav>

        <div className="pt-6 border-t border-slate-100">
          <div className="flex items-center gap-3 px-2 mb-6">
            <img src={user.photoURL || ""} alt={user.displayName || ""} className="w-10 h-10 rounded-full border-2 border-white shadow-sm" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-slate-900 truncate">{user.displayName}</p>
              <p className="text-xs text-slate-500 truncate">{user.email}</p>
            </div>
          </div>
          <Button variant="danger" onClick={handleLogout} className="w-full">
            <LogOut size={18} />
            Logout
          </Button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 p-8 overflow-y-auto">
        <div className="max-w-5xl mx-auto space-y-8">
          <header className="flex items-center justify-between">
            <div>
              <h2 className="text-3xl font-bold text-slate-900">
                {activeTab === 'generate' && "Generate Metadata"}
                {activeTab === 'history' && "Generation History"}
                {activeTab === 'settings' && "Settings"}
              </h2>
              <p className="text-slate-500">
                {activeTab === 'generate' && "Upload an image to get AI-powered Adobe Stock SEO."}
                {activeTab === 'history' && "View and manage your past generations."}
                {activeTab === 'settings' && "Configure your account and preferences."}
              </p>
            </div>
            {activeTab === 'generate' && selectedImage && (
              <Button variant="secondary" onClick={() => { setSelectedImage(null); setResult(null); }}>
                <Plus size={18} className="rotate-45" />
                Clear
              </Button>
            )}
          </header>

          <AnimatePresence mode="wait">
            {activeTab === 'generate' && (
              <motion.div
                key="generate"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="space-y-8"
              >
                {/* Top Options Strip */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <Card className="p-5 md:col-span-2">
                    <div className="flex flex-col md:flex-row gap-8 items-center">
                      <div className="flex-1 w-full space-y-2">
                        <div className="flex justify-between items-center">
                          <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Title Length: {titleWordCount} words</label>
                        </div>
                        <input 
                          type="range" 
                          min="5" 
                          max="25" 
                          value={titleWordCount}
                          onChange={(e) => setTitleWordCount(parseInt(e.target.value))}
                          className="w-full h-2 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-blue-600"
                        />
                      </div>
                      <div className="flex-1 w-full space-y-2">
                        <div className="flex justify-between items-center">
                          <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Keywords: {keywordCount}</label>
                        </div>
                        <input 
                          type="range" 
                          min="10" 
                          max="50" 
                          value={keywordCount}
                          onChange={(e) => setKeywordCount(parseInt(e.target.value))}
                          className="w-full h-2 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-blue-600"
                        />
                      </div>
                    </div>
                  </Card>

                  <div className="space-y-4">
                    <Button 
                      className="w-full py-4 text-lg h-full" 
                      disabled={!selectedImage || isGenerating}
                      isLoading={isGenerating}
                      onClick={handleGenerate}
                    >
                      <Sparkles size={20} />
                      {isGenerating ? "Analyzing..." : "Generate"}
                    </Button>
                  </div>
                </div>

                {error && (
                  <div className="p-4 bg-red-50 border border-red-100 rounded-xl text-red-600 text-sm flex items-start gap-3">
                    <X size={18} className="shrink-0 mt-0.5" />
                    <p>{error}</p>
                  </div>
                )}

                {/* Main Workspace: Image + Results */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
                  {/* Left: Image View */}
                  <Card 
                    className={cn(
                      "aspect-[4/3] flex flex-col items-center justify-center p-4 border-dashed border-2 transition-all cursor-pointer relative group bg-slate-100/50",
                      selectedImage ? "border-transparent p-0" : "border-slate-200 hover:border-blue-400"
                    )}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    {selectedImage ? (
                      <img src={selectedImage} alt="Preview" className="w-full h-full object-contain bg-slate-900 shadow-2xl" />
                    ) : (
                      <div className="text-center space-y-4">
                        <div className="w-16 h-16 bg-white rounded-2xl flex items-center justify-center mx-auto shadow-sm group-hover:scale-110 transition-transform">
                          <Upload className="text-blue-600" size={32} />
                        </div>
                        <div>
                          <p className="text-lg font-semibold text-slate-900">Upload your image</p>
                          <p className="text-sm text-slate-500">to start generating metadata</p>
                        </div>
                      </div>
                    )}
                    <input 
                      type="file" 
                      ref={fileInputRef} 
                      onChange={onFileChange} 
                      accept="image/*" 
                      className="hidden" 
                    />
                  </Card>

                  {/* Right: Metadata Result */}
                  <div className="space-y-6">
                    {result ? (
                      <motion.div
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        className="space-y-6"
                      >
                        <Card className="p-6 space-y-6">
                          <div className="flex justify-between items-center pb-4 border-b border-slate-100">
                             <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                               <Check className="text-green-600" size={16} />
                               Analysis Complete
                             </h3>
                             <Button variant="secondary" className="px-4 py-2 text-sm bg-blue-600 text-white hover:bg-blue-700 border-none" onClick={downloadCSV}>
                               <Download size={14} />
                               Download Adobe CSV
                             </Button>
                          </div>

                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                                Generated Title 
                                <span className="bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full text-[10px] font-bold">
                                  {result.title.split(/\s+/).filter(Boolean).length} words
                                </span>
                              </h3>
                              <Button variant="ghost" className="p-2 h-auto" onClick={copyTitle}>
                                {titleCopying ? <Check size={16} className="text-green-600" /> : <Copy size={16} />}
                              </Button>
                            </div>
                            <p className="text-lg font-medium text-slate-900 leading-relaxed">{result.title}</p>
                          </div>

                          <div className="space-y-4">
                            <div className="flex items-center justify-between">
                              <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                                Keywords 
                                <span className="bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full text-[10px] font-bold">
                                  {result.keywords.length} tags
                                </span>
                              </h3>
                              <div className="flex gap-2">
                                <Button variant="secondary" className="px-3 py-1.5 text-sm" onClick={copyToClipboard}>
                                  {copying ? <Check size={14} className="text-green-600" /> : <Copy size={14} />}
                                  {copying ? "Copied" : "Copy All"}
                                </Button>
                              </div>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {result.keywords.map((kw, i) => (
                                <span key={i} className="px-3 py-1 bg-slate-100 text-slate-700 rounded-lg text-sm font-medium border border-slate-200">
                                  {kw}
                                </span>
                              ))}
                            </div>
                          </div>
                        </Card>
                      </motion.div>
                    ) : (
                      <div className="h-full min-h-[400px] flex flex-col items-center justify-center text-center p-12 bg-slate-100/30 rounded-3xl border-2 border-dashed border-slate-200">
                        <div className="w-20 h-20 bg-white rounded-full flex items-center justify-center mb-6 shadow-sm">
                          <ImageIcon className="text-slate-200" size={40} />
                        </div>
                        <h3 className="text-xl font-bold text-slate-400">Review Section</h3>
                        <p className="text-slate-400 max-w-xs mx-auto mt-2">Metadata will appear here after analysis.</p>
                      </div>
                    )}
                  </div>
                </div>
              </motion.div>
            )}

            {activeTab === 'history' && (
              <motion.div
                key="history"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
              >
                {history.length > 0 ? history.map((item) => (
                  <Card key={item.id} className="group hover:shadow-md transition-shadow">
                    <div className="aspect-video relative overflow-hidden">
                      <img src={item.imageUrl} alt={item.title} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110" />
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                        <Button variant="secondary" className="bg-white/20 border-white/30 text-white backdrop-blur-md hover:bg-white/40" 
                          onClick={() => {
                            setResult({ title: item.title, keywords: item.keywords });
                            setSelectedImage(item.imageUrl);
                            setActiveTab('generate');
                          }}>
                          View
                        </Button>
                      </div>
                    </div>
                    <div className="p-4 space-y-2">
                      <p className="text-sm font-semibold text-slate-900 line-clamp-2">{item.title}</p>
                      <p className="text-xs text-slate-500">{new Date(item.createdAt?.toDate()).toLocaleDateString()}</p>
                    </div>
                  </Card>
                )) : (
                  <div className="col-span-full py-20 text-center">
                    <History className="mx-auto text-slate-300 mb-4" size={48} />
                    <h3 className="text-xl font-bold text-slate-900">History is empty</h3>
                    <p className="text-slate-500 mt-2">Your generated metadata will appear here.</p>
                  </div>
                )}
              </motion.div>
            )}

            {activeTab === 'settings' && (
              <motion.div
                key="settings"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="max-w-2xl"
              >
                <Card className="p-8 space-y-8">
                  <div className="flex items-center gap-6 pb-8 border-b border-slate-100">
                    <img src={user.photoURL || ""} alt={user.displayName || ""} className="w-24 h-24 rounded-3xl border-4 border-white shadow-lg" />
                    <div>
                      <h3 className="text-2xl font-bold text-slate-900">{user.displayName}</h3>
                      <p className="text-slate-500">{user.email}</p>
                      <div className="mt-4 flex gap-2">
                        <span className="px-3 py-1 bg-blue-50 text-blue-600 rounded-full text-xs font-bold uppercase tracking-wider">Pro Plan</span>
                        <span className="px-3 py-1 bg-green-50 text-green-600 rounded-full text-xs font-bold uppercase tracking-wider">Active</span>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-6">
                    <div className="p-6 bg-slate-50 rounded-2xl border border-slate-100 space-y-6">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center shadow-sm">
                            <Cpu className="text-blue-600" size={20} />
                          </div>
                          <div>
                            <p className="font-bold text-slate-900">AI Model Provider</p>
                            <p className="text-sm text-slate-500">Choose your preferred generation engine</p>
                          </div>
                        </div>
                        <div className="flex bg-white p-1 rounded-xl shadow-sm border border-slate-100">
                          <button 
                            onClick={() => setApiProvider('gemini')}
                            className={cn(
                              "px-4 py-2 rounded-lg text-sm font-semibold transition-all",
                              apiProvider === 'gemini' ? "bg-blue-600 text-white shadow-md shadow-blue-100" : "text-slate-500 hover:bg-slate-50"
                            )}
                          >
                            Gemini
                          </button>
                          <button 
                            onClick={() => setApiProvider('groq')}
                            className={cn(
                              "px-4 py-2 rounded-lg text-sm font-semibold transition-all",
                              apiProvider === 'groq' ? "bg-blue-600 text-white shadow-md shadow-blue-100" : "text-slate-500 hover:bg-slate-50"
                            )}
                          >
                            Groq (Free)
                          </button>
                        </div>
                      </div>

                      {apiProvider === 'groq' && (
                        <motion.div 
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          className="pt-6 border-t border-slate-200 space-y-4"
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center shadow-sm">
                                <Key className="text-blue-600" size={20} />
                              </div>
                              <div>
                                <p className="font-bold text-slate-900">Groq API Keys</p>
                                <p className="text-sm text-slate-500">{groqKeys.length} keys loaded from file</p>
                              </div>
                            </div>
                            <div className="flex gap-3">
                              {groqKeys.length > 0 && (
                                <Button variant="danger" onClick={() => setGroqKeys([])} className="px-4 py-2 text-sm">
                                  Clear Keys
                                </Button>
                              )}
                              <Button onClick={() => keyFileInputRef.current?.click()} className="px-4 py-2 text-sm">
                                <FileText size={16} />
                                Upload .txt Keys
                              </Button>
                              <input 
                                type="file" 
                                ref={keyFileInputRef}
                                onChange={onKeyFileChange}
                                accept=".txt"
                                className="hidden"
                              />
                            </div>
                          </div>
                          
                          {groqKeys.length > 0 && (
                            <div className="p-4 bg-white rounded-xl border border-slate-100 max-h-32 overflow-y-auto">
                              <div className="flex flex-wrap gap-2">
                                {groqKeys.map((key, i) => (
                                  <span key={i} className="px-2 py-1 bg-slate-50 text-slate-500 rounded text-[10px] font-mono border border-slate-100">
                                    {key.substring(0, 4)}...{key.substring(key.length - 4)}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                          
                          <div className="p-3 bg-blue-50 border border-blue-100 rounded-xl">
                            <p className="text-xs text-blue-700 leading-relaxed">
                              <strong>How it works:</strong> Upload a text file with one API key per line. If a key hits rate limits or fails, the generator will automatically switch to the next one in the list.
                            </p>
                          </div>
                        </motion.div>
                      )}
                    </div>

                    <div className="flex items-center justify-between px-2">
                      <div>
                        <p className="font-bold text-slate-900">AI Model</p>
                        <p className="text-sm text-slate-500">Gemini 3 Flash (Fastest)</p>
                      </div>
                      <Button variant="secondary">Change</Button>
                    </div>
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-bold text-slate-900">Default Style</p>
                        <p className="text-sm text-slate-500">Adobe Stock Optimized</p>
                      </div>
                      <Button variant="secondary">Manage</Button>
                    </div>
                  </div>
                </Card>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}
