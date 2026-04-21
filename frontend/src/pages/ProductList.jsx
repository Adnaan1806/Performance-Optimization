import React, { useEffect, useState } from 'react';
import _ from 'lodash';
import { api } from '../api';
import ProductCard from '../components/ProductCard.jsx';

export default function ProductList() {
  const [data, setData] = useState(null);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState(null);

  useEffect(() => {
    api.products().then(setData).catch((e) => setError(e.message));
  }, []);

  if (error) return <p>Error: {error}</p>;
  if (!data) return <p>Loading…</p>;

  // No memoization — recomputes on every render/keystroke.
  const filtered = _.sortBy(
    data.products.filter((p) => !filter || p.name.toLowerCase().includes(filter.toLowerCase())),
    (p) => Number(p.price)
  );

  return (
    <>
      <h2 className="section-title">All Products ({data.count})</h2>
      <input
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Filter by name…"
        style={{ padding: 8, marginBottom: 16, width: 300 }}
      />
      <div className="grid">
        {filtered.map((p) => <ProductCard key={p.id} product={p} />)}
      </div>
    </>
  );
}
