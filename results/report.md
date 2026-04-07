# Dewey FinanceBench Evaluation Results

**Endpoint:** `/research` (depth=exhaustive)  
**Dataset:** [FinanceBench open-source sample](https://github.com/patronus-ai/financebench) — 150 questions  
**Date:** 2026-04-07

## Overall Accuracy

Accuracy is the mean across 10 independent LLM-judge scoring runs (see Scoring Methodology below).

| System                                    | Accuracy | Notes                    |
| ----------------------------------------- | -------- | ------------------------ |
| Dewey /research (gpt-5.4)                 | 62.9%    | exhaustive, mean of 10 runs |
| Dewey /research (claude-opus-4-6)         | 84.0%    | exhaustive, mean of 10 runs |
| GPT-4-Turbo (vector RAG)                  | 19.0%    | FinanceBench paper, 2023 |
| GPT-4-Turbo (long-context, context-first) | 78.0%    | FinanceBench paper, 2023 |
| FinSage (agentic RAG)                     | 70.0%    | arXiv 2504.14493, 2025   |
| LinqAlpha (specialized)                   | 97.2%    | LinqAlpha blog, 2024     |

## Accuracy by Question Type

| Question Type                                                                                | gpt-5.4 | claude-opus-4-6 | n  |
| -------------------------------------------------------------------------------------------- | ------- | --------------- | -- |
| Information extraction                                                                       | 77.4%   | 90.3%           | 31 |
| Information extraction OR Logical reasoning                                                  | 100.0%  | 100.0%          | 1  |
| Information extraction OR Logical reasoning OR                                               | 100.0%  | 100.0%          | 1  |
| Logical reasoning (based on numerical reasoning)                                             | 60.0%   | 80.0%           | 5  |
| Logical reasoning (based on numerical reasoning) OR Logical reasoning                        | 60.0%   | 60.0%           | 5  |
| Logical reasoning (based on numerical reasoning) OR Numerical reasoning OR Logical reasoning | 100.0%  | 100.0%          | 4  |
| Numerical reasoning                                                                          | 53.5%   | 93.0%           | 43 |
| Numerical reasoning OR Logical reasoning                                                     | 50.0%   | 66.7%           | 6  |
| Numerical reasoning OR information extraction                                                | 25.0%   | 50.0%           | 4  |
|                                                                                              | 62.0%   | 74.0%           | 50 |

## Accuracy by Document Type

| Doc Type | gpt-5.4 | claude-opus-4-6 | n   |
| -------- | ------- | --------------- | --- |
| 10k      | 65.2%   | 87.5%           | 112 |
| 10q      | 40.0%   | 46.7%           | 15  |
| 8k       | 66.7%   | 100.0%          | 9   |
| Earnings | 64.3%   | 71.4%           | 14  |

## Latency & Tool Use (exhaustive depth)

| Model           | Mean  | p50   | p95    | Avg tool calls |
| --------------- | ----- | ----- | ------ | -------------- |
| gpt-5.4         | 22.3s | 18.2s | 49.8s  | 9.5            |
| claude-opus-4-6 | 77.8s | 59.8s | 195.5s | 22.6           |

## Sample Failures (Config A — GPT-5.4)

**financebench_id_00499** (Logical reasoning (based on numerical reasoning))  
Q: Is 3M a capital-intensive business based on FY2022 data?  
Gold: `No, the company is managing its CAPEX and Fixed Assets pretty efficiently, which is evident from below key metrics:
CAPEX/Revenue Ratio: 5.1%
Fixed assets/Total Assets: 20%
Return on Assets= 12.4%`  
Predicted: `## Short answer

**3M appears moderately capital-intensive, but not extremely so, based on FY2022 data.**  
It is clearly a manufacturing-heavy business that requires ongoing plant and equipment inves`  
Judge: The predicted answer states that 3M is "moderately capital-intensive," while the correct answer explicitly states that it is "not" capital-intensive, indicating a significant qualitative discrepancy.  

**financebench_id_00807** (Logical reasoning (based on numerical reasoning) OR Logical reasoning)  
Q: Does 3M have a reasonably healthy liquidity profile based on its quick ratio for Q2 of FY2023? If the quick ratio is not relevant to measure liquidity, please state that and explain why.  
Gold: `No. The quick ratio for 3M was 0.96 by Jun'23 close, which needs a bit of an improvement to touch the 1x mark`  
Predicted: `## Short answer

Yes — **based purely on the quick ratio, 3M looked reasonably healthy in Q2 FY2023**, but the quick ratio is **not the best standalone measure** of 3M’s liquidity. For 3M, liquidity s`  
Judge: The predicted answer states that 3M has a reasonably healthy liquidity profile based on the quick ratio, which contradicts the correct answer indicating that it needs improvement to reach the 1x mark.  

**financebench_id_04735** (Numerical reasoning)  
Q: You are an investment banker and your only resource(s) to answer the following question is (are): the statement of financial position and the cash flow statement. Here's the question: what is the FY2015 operating cash flow ratio for Adobe? Operating cash flow ratio is defined as: cash from operations / total current liabilities. Round your answer to two decimal places.  
Gold: `0.66`  
Predicted: `## Adobe FY2015 Operating Cash Flow Ratio

Using the formula:

\[
\text{Operating cash flow ratio}=\frac{\text{Cash from operations}}{\text{Total current liabilities}}
\]

Adobe’s FY2015 **cash from o`  
Judge: The predicted answer fails to provide a numerical value for the operating cash flow ratio, which is required to answer the question, and incorrectly states that the calculation cannot be made due to missing information.  

**financebench_id_07507** (Numerical reasoning)  
Q: What is Adobe's year-over-year change in unadjusted operating income from FY2015 to FY2016 (in units of percents and round to one decimal place)? Give a solution to the question by using the income statement.  
Gold: `65.4%`  
Predicted: `## Adobe FY2016 YoY Change in Unadjusted Operating Income

Using Adobe’s FY2016 income statement summary:

- **FY2016 operating income** = **Revenue − Cost of revenue − Operating expenses**
- From the`  
Judge: The predicted year-over-year change of 42.6% is incorrect as the correct value is 65.4%.  

**financebench_id_03856** (Numerical reasoning)  
Q: What is the FY2017 operating cash flow ratio for Adobe? Operating cash flow ratio is defined as: cash from operations / total current liabilities. Round your answer to two decimal places. Please utilize information provided primarily within the balance sheet and the cash flow statement.  
Gold: `0.83`  
Predicted: `## Adobe FY2017 Operating Cash Flow Ratio

Using the definition:

\[
\text{Operating cash flow ratio} = \frac{\text{Cash from operations}}{\text{Total current liabilities}}
\]

Adobe’s **cash from ope`  
Judge: The predicted answer fails to provide a numerical value for the operating cash flow ratio due to missing information, which is not acceptable as it does not answer the question.  

**financebench_id_00438** (Numerical reasoning OR information extraction)  
Q: Does Adobe have an improving operating margin profile as of FY2022? If operating margin is not a useful metric for a company like this, then state that and explain why.  
Gold: `No the operating margins of Adobe have recently declined from 36.8% in FY 2021 to 34.6% in FY2022. A drop by 2.2% in a year.`  
Predicted: `## Short answer

**Yes — Adobe’s operating margin profile was improving through FY2022.** Based on the FY2020–FY2022 income statement figures, revenue rose from **$12.868B** in 2020 to **$17.606B** in`  
Judge: The predicted answer incorrectly states that Adobe's operating margin profile was improving in FY2022, while the correct answer indicates a decline in operating margin from FY2021 to FY2022.  

**financebench_id_10420** (Numerical reasoning)  
Q: Based on the information provided primarily in the statement of financial position and the statement of income, what is AES's FY2022 return on assets (ROA)? ROA is defined as: FY2022 net income / (average total assets between FY2021 and FY2022). Round your answer to two decimal places.  
Gold: `-0.02`  
Predicted: `## AES FY2022 Return on Assets (ROA)

ROA is defined as:

\[
\text{ROA} = \frac{\text{FY2022 net income}}{\text{average total assets for FY2021 and FY2022}}
\]

### Inputs
- **FY2022 net income attrib`  
Judge: The predicted ROA of -1.53% does not match the correct answer of -0.02, which indicates a significant calculation error.  

**financebench_id_06655** (Numerical reasoning)  
Q: What is Amazon's FY2017 days payable outstanding (DPO)? DPO is defined as: 365 * (average accounts payable between FY2016 and FY2017) / (FY2017 COGS + change in inventory between FY2016 and FY2017). Round your answer to two decimal places. Address the question by using the line items and information shown within the balance sheet and the P&L statement.  
Gold: `93.86`  
Predicted: `## Amazon FY2017 DPO

I can’t compute the requested FY2017 DPO from the provided source list alone, because the cited Amazon sources available here only show **net sales** and a **stock-based compensa`  
Judge: The predicted answer fails to provide a numerical value for Amazon's FY2017 DPO, which is required to address the question correctly.  

**financebench_id_03882** (Information extraction)  
Q: What is Amcor's year end FY2020 net AR (in USD millions)? Address the question by adopting the perspective of a financial analyst who can only use the details shown within the balance sheet.  
Gold: `$1616.00`  
Predicted: `## Answer

From a **balance-sheet-only financial analyst perspective**, Amcor’s **year-end FY2020 net AR cannot be determined from the balance sheet excerpt provided**.

### Why
The Amcor FY2020 conso`  
Judge: The predicted answer states that the net AR cannot be determined from the balance sheet, while the correct answer provides a specific value of $1616 million.  

**financebench_id_01935** (null)  
Q: What was the key agenda of the AMCOR's 8k filing dated 1st July 2022?  
Gold: `Amcor Finance (USA), Inc. and Amcor Flexibles North America, Inc., entered into supplemental indentures relating to Guaranteed Senior Notes due 2026 and 2028. This involved the substitution of the Substitute Issuer (Amcor Flexibles North America) for the Former Issuer (Amcor Finance) and the assumption of covenants under the indentures. (In essence a novation agreement)`  
Predicted: `## Answer

Based on the available sources, the **specific “key agenda” of Amcor’s 8-K filed on July 1, 2022 cannot be determined from the provided corpus**.

What the sources do show is:

- There **wa`  
Judge: The predicted answer fails to provide the key facts about the supplemental indentures and the substitution of issuers, which are essential to understanding the agenda of the 8-K filing.  

## Scoring Methodology

Each answer is scored in two stages: (1) a numeric parser that applies a ±2.5% relative tolerance for financial figures, and (2) a GPT-4o-mini LLM judge for all remaining cases. Because the LLM judge is non-deterministic, accuracy figures are reported as the mean across 10 independent scoring runs rather than a single pass. Raw per-run data is in `results/ci.json`.

## Reproducing These Results

See the [README](../README.md) for full setup instructions.

```bash
cp .env.example .env   # fill in DEWEY_API_KEY and OPENAI_API_KEY
npm install
npm run ingest         # ~30 min  — uploads SEC filings to Dewey
npm run run            # ~5–8 hrs — runs 150 questions × 2 models
npm run score          # ~5 min   — scores with numeric + LLM judge
npm run report         # instant  — generates this report
npm run ci             # ~15 min  — 10-run CI analysis (used for accuracy figures above)
```
