"""
Generate charts for the FinanceBench evaluation blog post.
Output: results/charts/{accuracy,ablation,toolcalls,by_type}.png

Usage: python make_charts.py
"""

import json
import math
import os
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
import numpy as np

RESULTS_DIR = os.path.join(os.path.dirname(__file__), 'results')
CHARTS_DIR = os.path.join(
    os.path.dirname(__file__), '..', '..', 'apps', 'web', 'public', 'blog', 'financebench'
)
os.makedirs(CHARTS_DIR, exist_ok=True)

# ── Shared style ──────────────────────────────────────────────────────────────

DEWEY_BLUE   = '#2563EB'
DEWEY_GREEN  = '#16A34A'
BASELINE_GRAY = '#94A3B8'
ABLATION_RED  = '#DC2626'
ENHANCED_PURPLE = '#7C3AED'

plt.rcParams.update({
    'font.family': 'sans-serif',
    'font.size': 10,
    'axes.spines.top': False,
    'axes.spines.right': False,
    'axes.grid': True,
    'axes.grid.axis': 'x',
    'grid.alpha': 0.3,
    'grid.linestyle': '--',
    'figure.dpi': 150,
})

# ── Load data ─────────────────────────────────────────────────────────────────

def load_scored(label):
    path = os.path.join(RESULTS_DIR, f'config-{label}-scored.jsonl')
    if not os.path.exists(path):
        return []
    with open(path) as f:
        return [json.loads(l) for l in f if l.strip()]

def load_ci():
    with open(os.path.join(RESULTS_DIR, 'ci.json')) as f:
        return json.load(f)

def mean(xs):
    return sum(xs) / len(xs)

def ci95(xs):
    n = len(xs)
    s = math.sqrt(sum((x - mean(xs)) ** 2 for x in xs) / (n - 1))
    return 1.96 * s / math.sqrt(n)

# ── Chart 1: Overall accuracy comparison ─────────────────────────────────────

def chart_accuracy():
    ci = load_ci()

    systems = [
        ('GPT-4-Turbo, vector RAG\n(FinanceBench paper)', 0.190, BASELINE_GRAY, False),
        ('FinSage, agentic RAG\n(arXiv 2504.14493)', 0.700, BASELINE_GRAY, False),
        ('GPT-4-Turbo, full context\n(FinanceBench paper)', 0.780, BASELINE_GRAY, False),
        ('Dewey + GPT-5.4\n(this work)', mean(ci['A']), DEWEY_GREEN, True),
        ('Dewey + Claude Opus 4.6\n(this work)', mean(ci['B']), DEWEY_GREEN, True),
    ]

    ci_errors = {
        'Dewey + GPT-5.4\n(this work)': ci95(ci['A']),
        'Dewey + Claude Opus 4.6\n(this work)': ci95(ci['B']),
    }

    fig, ax = plt.subplots(figsize=(8, 4.5))

    labels = [s[0] for s in systems]
    values = [s[1] for s in systems]
    colors = [s[2] for s in systems]
    errors = [ci_errors.get(s[0], 0) for s in systems]

    bars = ax.barh(labels, values, color=colors, height=0.55,
                   xerr=errors, error_kw={'ecolor': '#475569', 'capsize': 3, 'linewidth': 1.2})

    for bar, val, err in zip(bars, values, errors):
        label = f'{val*100:.1f}%'
        ax.text(val + (err or 0) + 0.005, bar.get_y() + bar.get_height() / 2,
                label, va='center', fontsize=9, color='#1e293b')

    ax.set_xlim(0, 1.08)
    ax.set_xlabel('Accuracy on FinanceBench (150 questions)')
    ax.xaxis.set_major_formatter(plt.FuncFormatter(lambda x, _: f'{x:.0%}'))
    ax.set_title('FinanceBench Accuracy: Dewey vs. Published Baselines', fontsize=11, fontweight='bold', pad=12)

    dewey_patch = mpatches.Patch(color=DEWEY_GREEN, label='Dewey /research (this work)')
    baseline_patch = mpatches.Patch(color=BASELINE_GRAY, label='Published baselines')
    ax.legend(handles=[dewey_patch, baseline_patch], loc='lower right', fontsize=8)

    plt.tight_layout()
    path = os.path.join(CHARTS_DIR, 'accuracy.png')
    plt.savefig(path, bbox_inches='tight')
    plt.close()
    print(f'Saved {path}')

# ── Chart 2: Ablation study ───────────────────────────────────────────────────

def chart_ablation():
    ci = load_ci()

    configs = {
        'A-ablation': ('GPT-5.4\nno enrichment',  ABLATION_RED),
        'A':          ('GPT-5.4\ngpt-4o-mini enrichment', DEWEY_BLUE),
        'A-enhanced': ('GPT-5.4\ngpt-5.4 enrichment',   ENHANCED_PURPLE),
        'B-ablation': ('Claude Opus 4.6\nno enrichment', ABLATION_RED),
        'B':          ('Claude Opus 4.6\ngpt-4o-mini enrichment', DEWEY_GREEN),
        'B-enhanced': ('Claude Opus 4.6\ngpt-5.4 enrichment',   ENHANCED_PURPLE),
    }

    fig, axes = plt.subplots(1, 2, figsize=(10, 4), sharey=False)

    for ax, prefix, title in [
        (axes[0], 'A', 'GPT-5.4'),
        (axes[1], 'B', 'Claude Opus 4.6'),
    ]:
        labels = ['No enrichment', 'gpt-4o-mini\nenrichment', 'gpt-5.4\nenrichment']
        keys   = [f'{prefix}-ablation', prefix, f'{prefix}-enhanced']
        colors = [ABLATION_RED, DEWEY_BLUE if prefix == 'A' else DEWEY_GREEN, ENHANCED_PURPLE]
        vals   = [mean(ci[k]) for k in keys]
        errs   = [ci95(ci[k]) for k in keys]

        bars = ax.bar(labels, [v * 100 for v in vals], color=colors,
                      width=0.5, yerr=[e * 100 for e in errs],
                      error_kw={'ecolor': '#475569', 'capsize': 4, 'linewidth': 1.2})

        for bar, val, err in zip(bars, vals, errs):
            ax.text(bar.get_x() + bar.get_width() / 2, val * 100 + err * 100 + 0.4,
                    f'{val*100:.1f}%', ha='center', va='bottom', fontsize=9)

        ymin = min(v * 100 for v in vals) - 5
        ymax = max(v * 100 for v in vals) + 5
        ax.set_ylim(ymin, ymax)
        ax.set_ylabel('Accuracy (%)')
        ax.set_title(title, fontsize=11, fontweight='bold')
        ax.yaxis.set_major_formatter(plt.FuncFormatter(lambda x, _: f'{x:.0f}%'))
        ax.spines['top'].set_visible(False)
        ax.spines['right'].set_visible(False)
        ax.grid(axis='y', alpha=0.3, linestyle='--')
        ax.grid(axis='x', visible=False)

    fig.suptitle('Impact of Document Enrichment Features', fontsize=12, fontweight='bold', y=1.02)
    plt.tight_layout()
    path = os.path.join(CHARTS_DIR, 'ablation.png')
    plt.savefig(path, bbox_inches='tight')
    plt.close()
    print(f'Saved {path}')

# ── Chart 3: Tool call distribution ──────────────────────────────────────────

def chart_toolcalls():
    a_results = load_scored('A')
    b_results = load_scored('B')

    a_calls = [r['tool_call_count'] for r in a_results]
    b_calls = [r['tool_call_count'] for r in b_results]

    bins = [1, 6, 11, 16, 21, 26, 31, 51]
    bin_labels = ['1-5', '6-10', '11-15', '16-20', '21-25', '26-30', '31+']

    def bin_counts(calls, bins):
        counts = [0] * (len(bins) - 1)
        for c in calls:
            for i in range(len(bins) - 1):
                if bins[i] <= c < bins[i + 1]:
                    counts[i] += 1
                    break
        return counts

    a_counts = bin_counts(a_calls, bins)
    b_counts = bin_counts(b_calls, bins)

    x = np.arange(len(bin_labels))
    width = 0.38

    fig, ax = plt.subplots(figsize=(8, 4.2))
    ax.bar(x - width/2, a_counts, width, label=f'GPT-5.4 (mean {mean(a_calls):.1f})', color=DEWEY_BLUE, alpha=0.85)
    ax.bar(x + width/2, b_counts, width, label=f'Claude Opus 4.6 (mean {mean(b_calls):.1f})', color=DEWEY_GREEN, alpha=0.85)

    ax.set_xticks(x)
    ax.set_xticklabels(bin_labels)
    ax.set_xlabel('Tool calls per question')
    ax.set_ylabel('Number of questions')
    ax.set_title('Tool Call Distribution per Question\n(depth=exhaustive, n=150 each)', fontsize=11, fontweight='bold')
    ax.legend(fontsize=9)
    ax.grid(axis='x', visible=False)

    plt.tight_layout()
    path = os.path.join(CHARTS_DIR, 'toolcalls.png')
    plt.savefig(path, bbox_inches='tight')
    plt.close()
    print(f'Saved {path}')

# ── Chart 4: Accuracy by question type ───────────────────────────────────────

def chart_by_type():
    a_results = load_scored('A')
    b_results = load_scored('B')

    # Consolidate reasoning types into readable buckets
    def bucket(r):
        rt = r.get('question_reasoning') or ''
        if 'Numerical' in rt:
            return 'Numerical reasoning'
        if 'Information extraction' in rt:
            return 'Information extraction'
        if 'Logical' in rt:
            return 'Logical reasoning'
        return 'Other / unclassified'

    def acc_by_bucket(results):
        groups = {}
        for r in results:
            b = bucket(r)
            groups.setdefault(b, []).append(r['correct'])
        return {k: sum(v) / len(v) for k, v in groups.items()}

    buckets = ['Numerical reasoning', 'Information extraction', 'Logical reasoning', 'Other / unclassified']
    a_acc = acc_by_bucket(a_results)
    b_acc = acc_by_bucket(b_results)

    x = np.arange(len(buckets))
    width = 0.38

    fig, ax = plt.subplots(figsize=(9, 4.2))
    ax.bar(x - width/2, [a_acc.get(b, 0) * 100 for b in buckets], width,
           label='GPT-5.4', color=DEWEY_BLUE, alpha=0.85)
    ax.bar(x + width/2, [b_acc.get(b, 0) * 100 for b in buckets], width,
           label='Claude Opus 4.6', color=DEWEY_GREEN, alpha=0.85)

    for i, b in enumerate(buckets):
        for offset, acc_map in [(-width/2, a_acc), (width/2, b_acc)]:
            val = acc_map.get(b, 0) * 100
            ax.text(i + offset, val + 1, f'{val:.0f}%', ha='center', va='bottom', fontsize=8)

    ax.set_xticks(x)
    ax.set_xticklabels(buckets, fontsize=9)
    ax.set_ylim(0, 110)
    ax.set_ylabel('Accuracy (%)')
    ax.set_title('Accuracy by Question Reasoning Type', fontsize=11, fontweight='bold')
    ax.legend(fontsize=9)
    ax.yaxis.set_major_formatter(plt.FuncFormatter(lambda x, _: f'{x:.0f}%'))
    ax.grid(axis='x', visible=False)

    plt.tight_layout()
    path = os.path.join(CHARTS_DIR, 'by_type.png')
    plt.savefig(path, bbox_inches='tight')
    plt.close()
    print(f'Saved {path}')

# ── Run ───────────────────────────────────────────────────────────────────────

if __name__ == '__main__':
    chart_accuracy()
    chart_ablation()
    chart_toolcalls()
    chart_by_type()
    print('\nAll charts written to results/charts/')
