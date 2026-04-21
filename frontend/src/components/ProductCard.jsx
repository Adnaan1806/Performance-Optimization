import React from 'react';
import { Link } from 'react-router-dom';
import _ from 'lodash';
import moment from 'moment';
import { api } from '../api';

export default function ProductCard({ product }) {
  const name = _.truncate(product.name, { length: 36 });
  const when = product.created_at ? moment(product.created_at).fromNow() : '';
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
