import React from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr);
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  const days = Math.round(diff / 86400000);
  const hours = Math.round(diff / 3600000);
  const mins = Math.round(diff / 60000);
  if (days > 0)  return rtf.format(-days, 'day');
  if (hours > 0) return rtf.format(-hours, 'hour');
  return rtf.format(-mins, 'minute');
}

export default function ProductCard({ product }) {
  const name = product.name.length > 36 ? product.name.slice(0, 33) + '...' : product.name;
  const when = product.created_at ? timeAgo(product.created_at) : '';
  return (
    <Link to={`/products/${product.id}`} className="card">
      {/* Full-size image served at 200px. */}
      <img src={api.imageUrl(product.image_path)} alt={product.name} loading="eager" />
      <h3>{name}</h3>
      {product.category && <span className="pill">{product.category.name}</span>}
      <div className="price">LKR {Number(product.price).toLocaleString()}</div>
      {when && <div style={{ fontSize: 12, color: '#888' }}>{when}</div>}
    </Link>
  );
}
