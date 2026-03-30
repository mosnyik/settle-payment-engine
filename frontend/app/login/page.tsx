'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { login } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardDescription } from '@/components/ui/card';
import Logo from '@/components/Logo';

export default function LoginPage() {
  const router = useRouter();
  const [publicKey, setPublicKey] = useState('');
  const [secretKey, setSecretKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const result = await login(publicKey.trim(), secretKey.trim());
    if (result.ok) {
      router.push('/payments');
    } else {
      setError(result.error ?? 'Invalid credentials');
      setLoading(false);
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4"
      style={{ background: 'linear-gradient(135deg, #f0f4ff 0%, #f3eeff 45%, #fde8f4 100%)' }}
    >
      <div className="w-full max-w-sm">
        <div className="flex justify-center mb-6">
          <Logo />
        </div>
        <Card className="shadow-xl shadow-slate-200/60 border-slate-100">
          <CardHeader className="pb-4">
            <CardDescription className="text-slate-500">Sign in with your API key credentials</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="publicKey">Public Key</Label>
                <Input
                  id="publicKey"
                  type="text"
                  placeholder="pk_..."
                  value={publicKey}
                  onChange={(e) => setPublicKey(e.target.value)}
                  autoFocus
                  autoComplete="username"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="secretKey">Secret Key</Label>
                <Input
                  id="secretKey"
                  type="password"
                  placeholder="sk_..."
                  value={secretKey}
                  onChange={(e) => setSecretKey(e.target.value)}
                  autoComplete="current-password"
                />
              </div>
              {error && (
                <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  {error}
                </p>
              )}
              <Button
                type="submit"
                disabled={loading || !publicKey.trim() || !secretKey.trim()}
                className="w-full bg-[#2D6BE4] hover:bg-[#2560d0] text-white"
              >
                {loading ? 'Signing in...' : 'Sign In'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
