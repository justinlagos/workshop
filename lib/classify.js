// Applicant classification — rules v1 (approved workflow).
// Inputs: aiExperience, claudePlan, projectGoal. Output is deterministic,
// explainable, and stored with the applicant record.
//
// Scoring:
//   experience: Beginner 0 / Basic 2 / Intermediate 3
//   claude:     Yes 1 / otherwise 0
//   goal:       >=25 chars 1, plus >=60 chars an extra 1
// Bands:  >=4 Guided Builder (eligible for payment invite)
//         2-3 Review Required (manual review)
//         0-1 Foundation (future cohort)

export const RULES_VERSION = 'v1';

export const CLASSIFICATIONS = {
  GUIDED: 'Guided Builder',
  REVIEW: 'Review Required',
  FOUNDATION: 'Foundation',
};

export const FEES = {
  GBP: { amount: 5000, currency: 'gbp', label: '£50 GBP' },
  NGN: { amount: 8500000, currency: 'ngn', label: '₦85,000 NGN' },
};

export function feeFor(currency) {
  return currency === 'NGN' ? FEES.NGN : FEES.GBP;
}

export function classify({ aiExperience, claudePlan, projectGoal }) {
  const breakdown = [];
  let score = 0;

  let expPts = 0;
  if (aiExperience === 'Intermediate') expPts = 3;
  else if (aiExperience === 'Basic') expPts = 2;
  breakdown.push(`Experience ${aiExperience}: +${expPts}`);
  score += expPts;

  const claudePts = claudePlan === 'Yes' ? 1 : 0;
  breakdown.push(`Claude subscription ${claudePlan}: +${claudePts}`);
  score += claudePts;

  const len = (projectGoal || '').trim().length;
  let goalPts = 0;
  if (len >= 60) goalPts = 2;
  else if (len >= 25) goalPts = 1;
  breakdown.push(`Project goal ${len} chars: +${goalPts}`);
  score += goalPts;

  let classification;
  let eligible = false;
  if (score >= 4) {
    classification = CLASSIFICATIONS.GUIDED;
    eligible = true;
  } else if (score >= 2) {
    classification = CLASSIFICATIONS.REVIEW;
  } else {
    classification = CLASSIFICATIONS.FOUNDATION;
  }

  return { classification, eligible, score, breakdown, rulesVersion: RULES_VERSION };
}
