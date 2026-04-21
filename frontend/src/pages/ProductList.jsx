import React, { useEffect, useState } from 'react';
import { api } from '../api';
import ProductCard from '../components/ProductCard.jsx';

const LIMIT = 20;

export default function ProductList() {
  const [data, setData]   = useState(null);
  const [page, setPage]   = useState(1);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState(null);

  useEffect(() => {
    setData(null);
    api.products(page, LIMIT).then(setData).catch((e) => setError(e.message));
  }, [page]);

  if (error) return <p>Error: {error}</p>;
  if (!data)  return <p>Loading…</p>;

  const filtered = data.products.filter(
    (p) => !filter || p.name.toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <>
      <h2 className="section-title">
        All Products ({data.total}) — page {data.page} of {data.totalPages}
      </h2>
      <input
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Filter this page by name…"
        style={{ padding: 8, marginBottom: 16, width: 300 }}
      />
      <div className="grid">
        {filtered.map((p) => <ProductCard key={p.id} product={p} />)}
      </div>
      <div style={{ display: 'flex', gap: 12, marginTop: 24, alignItems: 'center' }}>
        <button onClick={() => setPage((p) => p - 1)} disabled={page <= 1}>
          ← Prev
        </button>
        <span>Page {page} of {data.totalPages}</span>
        <button onClick={() => setPage((p) => p + 1)} disabled={page >= data.totalPages}>
          Next →
        </button>
      </div>
    </>
  );
}
