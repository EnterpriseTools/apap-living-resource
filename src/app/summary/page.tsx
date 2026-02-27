'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { FileText, Loader2, AlertCircle, Send, MessageSquare } from 'lucide-react';
import { getProcessedData, getCurrentMonth, getSummaryForMonth, setSummaryForMonth } from '@/lib/storage';
import { buildSummaryBundle, type SummaryBundle, type GoalProgressInput } from '@/lib/summaryBundle';
import type { Agency, AgencyWithLabel } from '@/lib/schema';
import type { SimTelemetryMonthly } from '@/lib/schema';
import type { CohortSummary } from '@/lib/aggregate';
import { GOAL_MODEL_CONFIG } from '@/config/goal_model_config';
import { format, parseISO } from 'date-fns';
import { computeStructuralVarianceFromConfig, computeDriverProgressFromConfig } from '@/lib/goalProgressFromConfig';

type StoredData = {
  agencies: Agency[];
  agencyLabels: [string, AgencyWithLabel][];
  nearEligible: Agency[];
  dataQuality: any;
  asOfMonth: string | null;
  cohortSummaries: Record<string, CohortSummary[]>;
  simTelemetry?: SimTelemetryMonthly[];
};

type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
  errorDetails?: Record<string, unknown>;
};

/**
 * Simple markdown to HTML converter for basic markdown syntax
 */
function markdownToHtml(markdown: string): string {
  let html = markdown;
  
  // Code blocks (preserve as-is, wrap in pre)
  html = html.replace(/```[\s\S]*?```/g, (match) => {
    const code = match.replace(/```/g, '').trim();
    return `<pre style="background: var(--surface-1); padding: 1rem; border-radius: var(--radius-sm); overflow-x: auto; font-family: var(--font-mono); font-size: var(--text-body2-size);"><code>${code}</code></pre>`;
  });
  
  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code style="background: var(--surface-1); padding: 0.125rem 0.25rem; border-radius: 3px; font-family: var(--font-mono); font-size: 0.9em;">$1</code>');
  
  // Headers
  html = html.replace(/^### (.*$)/gim, '<h3 style="font-size: var(--text-subtitle-size); font-weight: var(--text-subtitle-weight); margin-top: 1.5rem; margin-bottom: 0.75rem; color: var(--fg-primary);">$1</h3>');
  html = html.replace(/^## (.*$)/gim, '<h2 style="font-size: var(--text-title-size); font-weight: var(--text-title-weight); margin-top: 2rem; margin-bottom: 1rem; color: var(--fg-primary);">$1</h2>');
  html = html.replace(/^# (.*$)/gim, '<h1 style="font-size: var(--text-headline-size); font-weight: var(--text-headline-weight); margin-top: 2rem; margin-bottom: 1rem; color: var(--fg-primary);">$1</h1>');
  
  // Bold
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  
  // Italic
  html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
  
  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" style="color: var(--fg-action); text-decoration: underline;">$1</a>');
  
  // Lists
  html = html.replace(/^\* (.*$)/gim, '<li style="margin-bottom: 0.5rem;">$1</li>');
  html = html.replace(/^- (.*$)/gim, '<li style="margin-bottom: 0.5rem;">$1</li>');
  html = html.replace(/^(\d+)\. (.*$)/gim, '<li style="margin-bottom: 0.5rem;">$2</li>');
  
  // Wrap consecutive list items in ul
  html = html.replace(/(<li[^>]*>.*<\/li>\n?)+/g, '<ul style="margin: 1rem 0; padding-left: 1.5rem;">$&</ul>');
  
  // Paragraphs (lines that aren't headers, lists, or code blocks)
  html = html.split('\n').map(line => {
    if (line.trim() === '') return '';
    if (line.startsWith('<h') || line.startsWith('<ul') || line.startsWith('</ul') || line.startsWith('<li') || line.startsWith('<pre') || line.startsWith('</pre')) {
      return line;
    }
    return `<p style="margin-bottom: 1rem; line-height: var(--text-body1-line);">${line}</p>`;
  }).join('\n');
  
  // Clean up empty paragraphs
  html = html.replace(/<p[^>]*>\s*<\/p>/g, '');
  
  return html;
}

const canShowErrorDetails =
  typeof process !== 'undefined' &&
  (process.env.NODE_ENV !== 'production' || process.env.NEXT_PUBLIC_DEBUG === 'true');

export default function SummaryPage() {
  const [data, setData] = useState<StoredData | null>(null);
  const [bundle, setBundle] = useState<SummaryBundle | null>(null);
  const [markdown, setMarkdown] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorDetails, setErrorDetails] = useState<Record<string, unknown> | null>(null);
  const [showErrorDetails, setShowErrorDetails] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [expandedChatDetailsIdx, setExpandedChatDetailsIdx] = useState<number | null>(null);

  useEffect(() => {
    // Load data for the viewing month (latest stored data for that month)
    const monthKey = getCurrentMonth();
    const stored = getProcessedData(monthKey ?? undefined);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        setData(parsed);

        const currentMonthData = parsed.agencies?.length
          ? { agencies: parsed.agencies, agencyLabels: parsed.agencyLabels ?? [], asOfMonth: parsed.asOfMonth }
          : null;

        let goalProgressInput: GoalProgressInput | undefined;
        if (currentMonthData) {
          const structuralResult = computeStructuralVarianceFromConfig(currentMonthData, GOAL_MODEL_CONFIG, 'high_confidence');
          const baselineRaw = getProcessedData('2025-11');
          let baselineMonthData = null;
          if (baselineRaw) {
            try {
              const baselineParsed = JSON.parse(baselineRaw);
              baselineMonthData = {
                agencies: baselineParsed.agencies ?? [],
                agencyLabels: Array.isArray(baselineParsed.agencyLabels) ? new Map(baselineParsed.agencyLabels) : new Map(),
                asOfMonth: '2025-11',
              };
            } catch {
              /* ignore */
            }
          }
          const driverResult = computeDriverProgressFromConfig(currentMonthData, baselineMonthData, GOAL_MODEL_CONFIG, 'high_confidence');
          goalProgressInput = {
            scenario: 'high_confidence',
            structuralResult: {
              overallApapActualPct: structuralResult.overallApapActualPct,
              overallPointsGap: structuralResult.overallPointsGap,
              topCohortGaps: structuralResult.topCohortGaps,
            },
            driverResult: {
              rows: driverResult.rows.map((r) => ({ driver: r.driver, lineSize: r.lineSize, variancePp: r.variancePp })),
            },
          };
        }

        const summaryBundle = buildSummaryBundle(parsed, 'trailing_12_months', goalProgressInput);
        setBundle(summaryBundle);
        // Load saved summary for this month if any (so user doesn't have to regenerate every visit)
        const saved = monthKey ? getSummaryForMonth(monthKey) : null;
        if (saved?.markdown) setMarkdown(saved.markdown);
      } catch (err) {
        console.error('Failed to parse stored data:', err);
        setError('Failed to load data. Please upload your files first.');
      }
    } else {
      setError('No data available. Please upload your files first.');
    }
  }, []);

  const handleGenerateSummary = async (bundleToUse?: SummaryBundle) => {
    const bundleForRequest = bundleToUse || bundle;
    if (!bundleForRequest) {
      setError('No bundle available');
      return;
    }

    setLoading(true);
    setError(null);
    setErrorDetails(null);

    try {
      const response = await fetch('/api/summary', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ bundle: bundleForRequest }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Failed to generate summary' }));
        setError(errorData.error || 'Failed to generate summary');
        setErrorDetails(errorData.details ?? null);
        return;
      }

      const result = await response.json();
      const newMarkdown = result.markdown || '';
      setMarkdown(newMarkdown);
      // Persist summary for this month so it's available when returning or switching months
      const monthKey = bundleForRequest.as_of_month
        ? String(bundleForRequest.as_of_month).slice(0, 7)
        : getCurrentMonth();
      if (monthKey && newMarkdown) setSummaryForMonth(monthKey, newMarkdown);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate summary');
    } finally {
      setLoading(false);
    }
  };

  const handleChatSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || !bundle || chatLoading) return;

    const userMessage: ChatMessage = { role: 'user', content: chatInput };
    setChatMessages(prev => [...prev, userMessage]);
    setChatInput('');
    setChatLoading(true);

    try {
      const response = await fetch('/api/summary/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          bundle,
          messages: [...chatMessages, userMessage],
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Failed to get response' }));
        const errorMessage: ChatMessage = {
          role: 'assistant',
          content: `Error: ${errorData.error || 'Failed to get response'}`,
          errorDetails: errorData.details,
        };
        setChatMessages(prev => [...prev, errorMessage]);
        return;
      }

      const result = await response.json();
      const assistantMessage: ChatMessage = { role: 'assistant', content: result.response || '' };
      setChatMessages(prev => [...prev, assistantMessage]);
    } catch (err) {
      const errorMessage: ChatMessage = {
        role: 'assistant',
        content: `Error: ${err instanceof Error ? err.message : 'Failed to get response'}`,
      };
      setChatMessages(prev => [...prev, errorMessage]);
    } finally {
      setChatLoading(false);
    }
  };

  if (!data) {
    return (
      <div style={{
        padding: '3rem 2rem',
        maxWidth: '1200px',
        margin: '0 auto',
        minHeight: 'calc(100vh - 80px)',
        background: 'var(--surface-1)',
      }}>
        <div style={{
          background: 'var(--surface-3)',
          padding: '3rem',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-md)',
          border: `1px solid var(--border-color)`,
          textAlign: 'center',
        }}>
          <h1 style={{
            fontSize: 'var(--text-headline-size)',
            lineHeight: 'var(--text-headline-line)',
            fontWeight: 'var(--text-headline-weight)',
            marginBottom: '1rem',
            color: 'var(--fg-primary)',
          }}>
            AI Summary
          </h1>
          <p style={{
            color: 'var(--fg-secondary)',
            marginBottom: '2rem',
            fontSize: 'var(--text-body1-size)',
          }}>
            {error || 'No data available. Please upload your files to get started.'}
          </p>
          <Link
            href="/upload"
            className="btn-primary"
            style={{
              padding: '1rem 2rem',
              background: 'var(--bg-action)',
              color: 'white',
              borderRadius: 'var(--radius-md)',
              fontSize: 'var(--text-button-size)',
              fontWeight: 'var(--text-button-weight)',
              letterSpacing: 'var(--text-button-letter)',
              textTransform: 'uppercase',
              display: 'inline-block',
              textDecoration: 'none',
              transition: 'all 0.2s ease',
              boxShadow: 'var(--shadow-sm)',
            }}
          >
            → Go to Upload Page
          </Link>
        </div>
      </div>
    );
  }

  const currentMonthKey = getCurrentMonth();
  const savedSummaryForMonth = currentMonthKey ? getSummaryForMonth(currentMonthKey) : null;

  const handleGenerateClick = () => {
    if (savedSummaryForMonth && currentMonthKey) {
      const monthLabel = format(parseISO(currentMonthKey + '-01'), 'MMM yyyy');
      if (!window.confirm(`This will overwrite the existing summary for ${monthLabel}. Continue?`)) return;
    }
    handleGenerateSummary();
  };

  return (
    <div style={{
      padding: '2rem',
      maxWidth: '1400px',
      margin: '0 auto',
      background: 'var(--surface-1)',
      minHeight: 'calc(100vh - 80px)',
    }}>
      <div style={{
        background: 'var(--surface-3)',
        padding: '2rem',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-md)',
        border: `1px solid var(--border-color)`,
      }}>
        {/* Header */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '2rem',
          flexWrap: 'wrap',
          gap: '1rem',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <div style={{
              background: 'linear-gradient(135deg, var(--bg-action) 0%, var(--fg-live) 100%)',
              padding: '0.75rem',
              borderRadius: 'var(--radius-md)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <FileText size={24} color="white" />
            </div>
            <div>
              <h1 style={{
                fontSize: 'var(--text-headline-size)',
                lineHeight: 'var(--text-headline-line)',
                fontWeight: 'var(--text-headline-weight)',
                color: 'var(--fg-primary)',
                marginBottom: '0.25rem',
              }}>
                AI Summary
              </h1>
              <p style={{
                fontSize: 'var(--text-body2-size)',
                color: 'var(--fg-secondary)',
              }}>
                {bundle?.as_of_month
                  ? `Summary for ${format(parseISO(String(bundle.as_of_month).slice(0, 7) + '-01'), 'MMM yyyy')}`
                  : 'Executive summary of VR APAP metrics'}
              </p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              onClick={() => setShowChat(!showChat)}
              style={{
                padding: '0.75rem 1.5rem',
                background: showChat ? 'var(--fg-secondary)' : 'var(--surface-4)',
                color: showChat ? 'white' : 'var(--fg-primary)',
                border: `1px solid var(--border-color)`,
                borderRadius: 'var(--radius-md)',
                fontSize: 'var(--text-button-size)',
                fontWeight: 'var(--text-button-weight)',
                letterSpacing: 'var(--text-button-letter)',
                textTransform: 'uppercase',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                transition: 'all 0.2s ease',
              }}
            >
              <MessageSquare size={16} />
              Ask Questions
            </button>
            <button
              onClick={handleGenerateClick}
              disabled={loading || !bundle}
              style={{
                padding: '0.75rem 1.5rem',
                background: loading ? 'var(--fg-disabled)' : 'var(--bg-action)',
                color: 'white',
                border: 'none',
                borderRadius: 'var(--radius-md)',
                fontSize: 'var(--text-button-size)',
                fontWeight: 'var(--text-button-weight)',
                letterSpacing: 'var(--text-button-letter)',
                textTransform: 'uppercase',
                cursor: loading || !bundle ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                transition: 'all 0.2s ease',
                boxShadow: 'var(--shadow-sm)',
              }}
            >
              {loading ? (
                <>
                  <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
                  Generating...
                </>
              ) : savedSummaryForMonth ? (
                'Regenerate summary'
              ) : (
                'Generate summary'
              )}
            </button>
          </div>
        </div>

        {/* Error message */}
        {error && (
          <div style={{
            padding: '1rem',
            background: 'var(--bg-alert)',
            color: 'white',
            borderRadius: 'var(--radius-md)',
            marginBottom: '2rem',
            fontSize: 'var(--text-body1-size)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: errorDetails && canShowErrorDetails ? '0.5rem' : 0 }}>
              <AlertCircle size={20} />
              {error}
            </div>
            {errorDetails && canShowErrorDetails && (
              <div style={{ marginTop: '0.5rem' }}>
                <button
                  type="button"
                  onClick={() => setShowErrorDetails(prev => !prev)}
                  style={{
                    background: 'rgba(255,255,255,0.2)',
                    border: '1px solid rgba(255,255,255,0.4)',
                    color: 'white',
                    padding: '0.25rem 0.5rem',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: 'var(--text-body2-size)',
                    cursor: 'pointer',
                  }}
                >
                  {showErrorDetails ? 'Hide details' : 'Show details'}
                </button>
                {showErrorDetails && (
                  <pre style={{
                    marginTop: '0.5rem',
                    padding: '1rem',
                    background: 'var(--surface-1)',
                    color: 'var(--fg-primary)',
                    borderRadius: 'var(--radius-sm)',
                    overflow: 'auto',
                    fontSize: 'var(--text-body2-size)',
                    fontFamily: 'var(--font-mono)',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    maxHeight: '300px',
                  }}>
                    {JSON.stringify(errorDetails, null, 2)}
                  </pre>
                )}
              </div>
            )}
          </div>
        )}

        {/* Chat Interface */}
        {showChat && (
          <div style={{
            marginBottom: '2rem',
            border: `1px solid var(--border-color)`,
            borderRadius: 'var(--radius-md)',
            background: 'var(--surface-2)',
            maxHeight: '500px',
            display: 'flex',
            flexDirection: 'column',
          }}>
            <div style={{
              padding: '1rem',
              borderBottom: `1px solid var(--border-color)`,
              background: 'var(--surface-3)',
              borderRadius: 'var(--radius-md) var(--radius-md) 0 0',
            }}>
              <h3 style={{
                fontSize: 'var(--text-subtitle-size)',
                fontWeight: 'var(--text-subtitle-weight)',
                color: 'var(--fg-primary)',
                margin: 0,
              }}>
                Ask Questions About the Summary
              </h3>
            </div>
            <div style={{
              flex: 1,
              overflowY: 'auto',
              padding: '1rem',
              minHeight: '300px',
            }}>
              {chatMessages.length === 0 ? (
                <div style={{
                  color: 'var(--fg-secondary)',
                  fontSize: 'var(--text-body2-size)',
                  fontStyle: 'italic',
                  textAlign: 'center',
                  padding: '2rem',
                }}>
                  Ask questions about the summary, metrics, or trends...
                </div>
              ) : (
                chatMessages.map((msg, idx) => (
                  <div
                    key={idx}
                    style={{
                      marginBottom: '1rem',
                      padding: '0.75rem',
                      background: msg.role === 'user' ? 'var(--surface-3)' : 'var(--surface-1)',
                      borderRadius: 'var(--radius-sm)',
                      alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
                    }}
                  >
                    <div style={{
                      fontSize: 'var(--text-body2-size)',
                      fontWeight: 'var(--text-subtitle-weight)',
                      color: 'var(--fg-secondary)',
                      marginBottom: '0.25rem',
                    }}>
                      {msg.role === 'user' ? 'You' : 'Assistant'}
                    </div>
                    <div
                      style={{
                        fontSize: 'var(--text-body1-size)',
                        color: 'var(--fg-primary)',
                        whiteSpace: 'pre-wrap',
                      }}
                      dangerouslySetInnerHTML={{ __html: markdownToHtml(msg.content) }}
                    />
                    {msg.errorDetails && canShowErrorDetails && (
                      <div style={{ marginTop: '0.5rem' }}>
                        <button
                          type="button"
                          onClick={() => setExpandedChatDetailsIdx(prev => (prev === idx ? null : idx))}
                          style={{
                            background: 'var(--surface-3)',
                            border: '1px solid var(--border-color)',
                            color: 'var(--fg-primary)',
                            padding: '0.25rem 0.5rem',
                            borderRadius: 'var(--radius-sm)',
                            fontSize: 'var(--text-body2-size)',
                            cursor: 'pointer',
                          }}
                        >
                          {expandedChatDetailsIdx === idx ? 'Hide details' : 'Show details'}
                        </button>
                        {expandedChatDetailsIdx === idx && (
                          <pre style={{
                            marginTop: '0.5rem',
                            padding: '1rem',
                            background: 'var(--surface-2)',
                            color: 'var(--fg-primary)',
                            borderRadius: 'var(--radius-sm)',
                            overflow: 'auto',
                            fontSize: 'var(--text-body2-size)',
                            fontFamily: 'var(--font-mono)',
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-word',
                            maxHeight: '300px',
                          }}>
                            {JSON.stringify(msg.errorDetails, null, 2)}
                          </pre>
                        )}
                      </div>
                    )}
                  </div>
                ))
              )}
              {chatLoading && (
                <div style={{
                  padding: '0.75rem',
                  color: 'var(--fg-secondary)',
                  fontSize: 'var(--text-body2-size)',
                  fontStyle: 'italic',
                }}>
                  <Loader2 size={16} style={{ animation: 'spin 1s linear infinite', display: 'inline-block', marginRight: '0.5rem' }} />
                  Thinking...
                </div>
              )}
            </div>
            <form onSubmit={handleChatSubmit} style={{
              padding: '1rem',
              borderTop: `1px solid var(--border-color)`,
              display: 'flex',
              gap: '0.5rem',
            }}>
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Ask a question about the summary..."
                disabled={chatLoading}
                style={{
                  flex: 1,
                  padding: '0.75rem',
                  border: `1px solid var(--border-color)`,
                  borderRadius: 'var(--radius-sm)',
                  fontSize: 'var(--text-body1-size)',
                  background: 'var(--surface-3)',
                  color: 'var(--fg-primary)',
                }}
              />
              <button
                type="submit"
                disabled={!chatInput.trim() || chatLoading}
                style={{
                  padding: '0.75rem 1.5rem',
                  background: chatInput.trim() && !chatLoading ? 'var(--bg-action)' : 'var(--fg-disabled)',
                  color: 'white',
                  border: 'none',
                  borderRadius: 'var(--radius-sm)',
                  cursor: chatInput.trim() && !chatLoading ? 'pointer' : 'not-allowed',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                }}
              >
                <Send size={16} />
              </button>
            </form>
          </div>
        )}

        {/* Generated Summary */}
        {loading && !markdown && (
          <div style={{
            padding: '3rem',
            textAlign: 'center',
            color: 'var(--fg-secondary)',
          }}>
            <Loader2 size={32} style={{ animation: 'spin 1s linear infinite', margin: '0 auto 1rem' }} />
            <p>Generating summary...</p>
          </div>
        )}

        {markdown && (
          <div style={{
            padding: '2rem',
            background: 'var(--surface-2)',
            borderRadius: 'var(--radius-md)',
            border: `1px solid var(--border-color)`,
          }}>
            <div
              style={{
                fontSize: 'var(--text-body1-size)',
                lineHeight: 'var(--text-body1-line)',
                color: 'var(--fg-primary)',
              }}
              dangerouslySetInnerHTML={{ __html: markdownToHtml(markdown) }}
            />
          </div>
        )}

        {/* Empty state when no summary for this month */}
        {!markdown && !loading && (
          <div style={{
            padding: '3rem',
            textAlign: 'center',
            color: 'var(--fg-secondary)',
          }}>
            <p style={{
              fontSize: 'var(--text-body1-size)',
              marginBottom: '1rem',
            }}>
              No summary for this month yet. Click Generate summary to create one.
            </p>
          </div>
        )}
      </div>

      <style jsx>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
