import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import moment from 'moment';
import { api } from '../api';

export default function ProductDetail() {
  const { id } = useParams();
  const [product, setProduct] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.product(id).then(setProduct).catch((e) => setError(e.message));
  }, [id]);

  if (error) return <p>Error: {error}</p>;
  if (!product) return <p>Loading…</p>;

  const avg = product.reviews.length
    ? (product.reviews.reduce((a, r) => a + r.rating, 0) / product.reviews.length).toFixed(1)
    : '—';

  return (
    <div className="detail">
      <div>
        {/* Full-size hero image from disk. */}
        <img src={api.imageUrl(product.image_path)} alt={product.name} />
      </div>
      <div>
        <h1>{product.name}</h1>
        {product.category && <div className="pill">{product.category.name}</div>}
        <p>{product.description}</p>
        <p className="price">LKR {Number(product.price).toLocaleString()}</p>
        <p>Stock: {product.stock}</p>
        <p>Rating: {avg} ({product.reviews.length} reviews)</p>
        <h3>Reviews</h3>
        {product.reviews.map((r) => (
          <div key={r.id} className="review">
            <strong>{r.rating}★</strong> — {r.body}
            <span style={{ float: 'right', color: '#888', fontSize: 12 }}>
              {moment(r.created_at).fromNow()}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
