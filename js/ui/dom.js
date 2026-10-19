(function (APA) {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  }

  const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });

  const format = {
    money: (value) => (Number.isFinite(value) ? money.format(value) : '—'),
    signedMoney: (value) => (Number.isFinite(value) ? `${value > 0 ? '+' : ''}${money.format(value)}` : '—'),
    price: (instrument, value) => (Number.isFinite(value) ? APA.instruments.formatPrice(instrument, value) : '—'),
    percent: (value, digits = 1) => (Number.isFinite(value) ? `${(value * 100).toFixed(digits)}%` : '—'),
    number: (value, digits = 2) => (Number.isFinite(value) ? value.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits }) : '—'),
    r: (value) => (Number.isFinite(value) ? `${value > 0 ? '+' : ''}${value.toFixed(2)}R` : '—'),
    ratio: (value) => (Number.isFinite(value) ? `1:${value.toFixed(1)}` : '—'),
    profitFactor: (value) => (value === Infinity ? '∞' : Number.isFinite(value) ? value.toFixed(2) : '—'),
    time: (epochSeconds) => (Number.isFinite(epochSeconds)
      ? `${new Date(epochSeconds * 1000).toISOString().slice(5, 16).replace('T', ' ')} UTC` : '—'),
    date: (epochSeconds) => new Date(epochSeconds * 1000).toISOString().slice(0, 10),
    trend: (trend) => ({ up: 'Bullish', down: 'Bearish' }[trend] || 'Unclear'),
  };

  const toneOf = (value) => (value > 0 ? 'bull' : value < 0 ? 'bear' : '');
  const trendTone = (trend) => ({ up: 'bull', down: 'bear' }[trend] || 'wait');

  function toast(message, kind = 'success') {
    const element = document.createElement('div');
    element.className = `toast toast-${kind}`;
    element.textContent = message;
    $('#toasts').appendChild(element);
    setTimeout(() => element.remove(), kind === 'error' ? 7000 : 3800);
  }

  /** A row of radio-style buttons. Calls onChange(value) when the user picks one. */
  function segmented(container, options, value, onChange) {
    container.innerHTML = options.map((option) => `
      <button type="button" role="radio" data-value="${escapeHtml(option.value)}" aria-checked="${option.value === value}">${escapeHtml(option.label)}</button>`).join('');
    container.onclick = (event) => {
      const button = event.target.closest('button[data-value]');
      if (!button) return;
      $$('button', container).forEach((other) => other.setAttribute('aria-checked', String(other === button)));
      onChange(button.dataset.value);
    };
  }

  function segmentedValue(container) {
    const selected = $('button[aria-checked="true"]', container);
    return selected ? selected.dataset.value : null;
  }

  // Field errors say which box is wrong and why, and move focus to it.
  function showFieldError(form, fieldName, message) {
    const input = form.elements[fieldName];
    if (!input) { toast(message, 'error'); return; }
    input.setAttribute('aria-invalid', 'true');
    const holder = input.closest('.field') || input.parentElement;
    let text = $('.error-text', holder);
    if (!text) { text = document.createElement('span'); text.className = 'error-text'; holder.appendChild(text); }
    text.textContent = message;
    input.focus();
  }

  function clearFieldErrors(form) {
    $$('[aria-invalid="true"]', form).forEach((input) => input.removeAttribute('aria-invalid'));
    $$('.error-text', form).forEach((text) => text.remove());
  }

  function numberFrom(form, name) {
    const raw = form.elements[name] ? String(form.elements[name].value).trim() : '';
    return raw === '' ? NaN : Number(raw);
  }

  function emptyState(title, text, icon = 'empty') {
    return `<div class="empty">${APA.icons[icon] || ''}<strong>${escapeHtml(title)}</strong><p>${escapeHtml(text)}</p></div>`;
  }

  function loading(text) {
    return `<div class="loading-row"><span class="spinner"></span>${escapeHtml(text)}</div>`;
  }

  function instrumentOptions(instruments, selected) {
    const groups = [...new Set(instruments.map((instrument) => instrument.group))];
    return groups.map((group) => `<optgroup label="${escapeHtml(group)}">${instruments.filter((instrument) => instrument.group === group)
      .map((instrument) => `<option value="${escapeHtml(instrument.symbol)}" ${instrument.symbol === selected ? 'selected' : ''}>${escapeHtml(instrument.shortName)}</option>`).join('')}</optgroup>`).join('');
  }

  function modelOptions(selected, includeBlank = false) {
    const blank = includeBlank ? `<option value="">Not set</option>` : '';
    return blank + APA.zones.models.map((model) => `<option value="${model.id}" ${model.id === selected ? 'selected' : ''}>${escapeHtml(model.name)}</option>`).join('');
  }

  APA.ui = { $, $$, escapeHtml, format, toneOf, trendTone, toast, segmented, segmentedValue,
    showFieldError, clearFieldErrors, numberFrom, emptyState, loading, instrumentOptions, modelOptions };
})((globalThis.APA = globalThis.APA || {}));
