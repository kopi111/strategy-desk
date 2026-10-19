(function (APA) {
  'use strict';

  const { escapeHtml, format, toneOf } = APA.ui;

  // Shared by Analytics and Backtest so both show results the same way.

  function statGrid(summary) {
    const stats = [
      ['Trades', String(summary.count)],
      ['Win rate', summary.count ? format.percent(summary.winRate) : '—'],
      ['Net P&L', format.signedMoney(summary.net), toneOf(summary.net)],
      ['Net return', summary.count ? `${summary.netPercent >= 0 ? '+' : ''}${summary.netPercent.toFixed(2)}%` : '—', toneOf(summary.netPercent)],
      ['Profit factor', summary.count ? format.profitFactor(summary.profitFactor) : '—'],
      ['Max drawdown', summary.count ? `${format.money(-summary.maxDrawdown)} · ${summary.maxDrawdownPercent.toFixed(1)}%` : '—', summary.maxDrawdown ? 'bear' : ''],
      ['Average win', format.money(summary.averageWin), 'bull'],
      ['Average loss', format.money(summary.averageLoss), summary.averageLoss ? 'bear' : ''],
      ['Average R', summary.averageR === null ? '—' : format.r(summary.averageR), toneOf(summary.averageR)],
      ['Total R', summary.totalR === null ? '—' : format.r(summary.totalR), toneOf(summary.totalR)],
    ];
    return `<div class="stat-grid">${stats.map(([label, value, tone = '']) => `<div class="stat"><span>${label}</span><strong class="${tone}">${escapeHtml(value)}</strong></div>`).join('')}</div>`;
  }

  function groupBars(groups) {
    if (!groups.length) return '<p class="muted">No trades yet.</p>';
    const largest = Math.max(...groups.map((group) => Math.abs(group.net)), 1);
    return `<div class="bars">${groups.map((group) => {
      const width = (Math.abs(group.net) / largest) * 50;
      return `<div class="bar-row"><span class="label" title="${escapeHtml(group.name)}">${escapeHtml(group.name)} <span class="faint">(${group.count})</span></span>
        <div class="bar-track"><div class="bar-fill ${group.net >= 0 ? 'positive' : 'negative'}" style="width:${width}%"></div></div>
        <span class="value ${toneOf(group.net)}">${format.signedMoney(group.net)}</span></div>`;
    }).join('')}</div>`;
  }

  function groupTable(groups) {
    if (!groups.length) return '<p class="muted">No trades yet.</p>';
    return `<div class="table-wrap"><table><thead><tr><th>Group</th><th class="num">Trades</th><th class="num">Win rate</th><th class="num">Profit factor</th><th class="num">Avg R</th><th class="num">Net</th></tr></thead><tbody>
      ${groups.map((group) => `<tr><td>${escapeHtml(group.name)}</td><td class="num">${group.count}</td><td class="num">${format.percent(group.winRate)}</td>
        <td class="num">${format.profitFactor(group.profitFactor)}</td><td class="num ${toneOf(group.averageR)}">${group.averageR === null ? '—' : format.r(group.averageR)}</td>
        <td class="num ${toneOf(group.net)}">${format.signedMoney(group.net)}</td></tr>`).join('')}</tbody></table></div>`;
  }

  /** Mounts (or replaces) an equity chart inside container and plots the curve, starting at the opening balance. */
  function drawEquity(container, holder, summary, startingBalance) {
    if (holder.chart) { holder.chart.destroy(); holder.chart = null; }
    container.innerHTML = '';
    if (!summary.equity.length) { container.innerHTML = APA.ui.emptyState('No equity curve yet', 'It appears after the first closed trade.', 'analytics'); return; }
    try {
      holder.chart = new APA.EquityChart(container);
      const firstTime = summary.equity[0].time - 1;
      holder.chart.setPoints([{ time: firstTime, value: startingBalance }, ...summary.equity]);
    } catch (error) {
      container.innerHTML = APA.ui.emptyState('Chart unavailable', error.message, 'analytics');
    }
  }

  APA.performancePanels = { statGrid, groupBars, groupTable, drawEquity };
})((globalThis.APA = globalThis.APA || {}));
