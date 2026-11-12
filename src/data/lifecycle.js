// Roles. One external (client), three on the governance team.
export const ROLES = {
  client: { name: 'Client', side: 'Client portal', home: '/dashboard' },
  assessor: { name: 'Governance reviewer', side: 'Governance team', home: '/dashboard' },
  lead: { name: 'Governance lead', side: 'Governance team', home: '/dashboard' },
  admin: { name: 'Administrator', side: 'Governance team', home: '/dashboard' },
};
export const TEAM_ROLES = ['assessor', 'lead', 'admin'];

// Core rule from the Responsible AI charter.
export const CORE_RULE = 'No AI system moves to production until its use is registered, its risk is classified, applicable assessments and tests are complete, required reviewers have approved it, and production monitoring and incident response are operational.';

// The charter's ten lifecycle stages: objective, process, checklist, required evidence and exit gate.
export const STAGES = [
  {
    n: 1, name: 'Ideation and intake', short: 'Intake', outcome: 'Legitimate AI use case with an accountable owner', gate: 'Registered and screened',
    objective: 'Confirm that the problem is legitimate, AI is appropriate, stakeholders are known, and accountable ownership exists.',
    process: ['Define the problem, users, affected parties, intended outcomes and measurable benefits.', 'Compare AI and non-AI alternatives.', 'Register the use case and identify applicable policies, jurisdictions and control functions.', 'Complete initial risk screening and assign a preliminary tier.', 'Plan stakeholder engagement and lifecycle gates.'],
    checklist: ['The problem and intended outcome are clearly defined.', 'Non-AI alternatives and simpler models have been considered.', 'Intended users and affected non-users are identified.', 'Intended use, foreseeable misuse and prohibited use are documented.', 'A business owner, model owner and program manager are assigned.', 'The use case is entered into the inventory.', 'Initial risk classification and review path are complete.'],
    evidence: ['Use-case intake form', 'Initial risk classification', 'Problem statement and benefits hypothesis', 'Stakeholder map', 'Preliminary review record'],
    exit: 'Use case is registered, ownership is assigned, preliminary risk is accepted, and the required assessment plan is approved.',
  },
  {
    n: 2, name: 'Impact assessment and requirements', short: 'Impact assessment', outcome: 'Benefits, affected parties and harms understood', gate: 'Risk treatment agreed',
    objective: 'Identify benefits, affected stakeholders, potential harms and control requirements before major design commitments.',
    process: ['Map stakeholders, contexts of use, decision pathways and potential impacts.', 'Assess severity, likelihood, exposure, reversibility and distribution of benefits and harms.', 'Consult appropriate affected or representative stakeholders.', 'Define legal, privacy, security, accessibility, transparency, fairness and human-oversight requirements.', 'Assign risk owners, mitigations, due dates and residual-risk authority.'],
    checklist: ['Benefits are measurable and realistically attributable.', 'Affected and vulnerable groups are considered.', 'Foreseeable failure, misuse and abuse scenarios are documented.', 'Direct, indirect, cumulative and downstream harms are considered.', 'Risks are scored using the approved methodology.', 'Controls and acceptance criteria are defined.', 'Residual risk is within appetite or escalated.', 'Required control functions approve the assessment.'],
    evidence: ['AI impact assessment', 'Legal and regulatory assessment', 'Privacy impact assessment where applicable', 'Threat model and abuse-case analysis', 'Risk register and treatment plan', 'Stakeholder consultation record'],
    exit: 'The impact assessment is approved, mandatory controls are incorporated into requirements and no unaccepted risk blocks design.',
  },
  {
    n: 3, name: 'Data acquisition and preparation', short: 'Data', outcome: 'Authorized, suitable and traceable data', gate: 'Data readiness approved',
    objective: 'Ensure that data is authorized, relevant, representative, sufficiently accurate, secure and traceable.',
    process: ['Identify source, owner, license, permitted purpose, provenance and data subjects.', 'Assess data quality, coverage, representativeness, timeliness and label quality.', 'Minimize personal and confidential data and define retention and deletion.', 'Separate training, validation and test data; manage leakage and duplicates.', 'Version datasets and implement access, lineage and change controls.'],
    checklist: ['Every data source has an accountable owner and permitted-use basis.', 'Licenses, notices, consent and contractual restrictions are documented.', 'Sensitive values are identified and protected.', 'Data is adequate and representative for intended contexts.', 'Quality issues and subgroup gaps are measured and treated.', 'Labels and annotations undergo quality review.', 'Training and evaluation datasets are independent.', 'Retention, deletion and access requirements are implemented.', 'Poisoning, tampering and unauthorized data entry risks are addressed.', 'Dataset versions can be reproduced.'],
    evidence: ['Data sheet or data card', 'Source and license register', 'Data-quality and representativeness report', 'Privacy and security approvals', 'Dataset lineage, version and access record'],
    exit: 'Data owner and applicable privacy, security or legal reviewer confirm readiness for the stated purpose.',
  },
  {
    n: 4, name: 'Design and development', short: 'Design and build', outcome: 'Controls embedded in architecture and experience', gate: 'Design review completed',
    objective: 'Embed Responsible AI requirements in architecture, model choice, user experience and operating controls.',
    process: ['Select the least complex model that meets legitimate needs.', 'Design human oversight, explanations, notices, feedback, appeal and fallback.', 'Implement secure development, identity, authorization, logging and secrets controls.', 'Define operating boundaries, confidence thresholds and safe-failure behavior.', 'Version models, prompts, retrieval sources, code, policies and configurations.'],
    checklist: ['Model choice and alternatives are justified.', 'Operating conditions, limitations and out-of-scope uses are explicit.', 'Human reviewers have the information and authority needed to intervene.', 'Users can reject, override or escalate outputs where appropriate.', 'Access follows least privilege and separation of duties.', 'Accessibility and inclusive design requirements are implemented.', 'Deployment architecture supports monitoring, rollback and kill switch.', 'Third-party dependencies and update behavior are controlled.'],
    evidence: ['Architecture and data-flow diagrams', 'Model or system card draft', 'Human oversight plan', 'Security design and threat model', 'User-experience and transparency specifications', 'Configuration and version records'],
    exit: 'Design review confirms that mandatory controls are implemented or tracked to closure before validation.',
  },
  {
    n: 5, name: 'Testing and independent validation', short: 'Test and validate', outcome: 'Performance and Responsible AI risks measured', gate: 'Acceptance criteria met',
    objective: 'Demonstrate that the system meets functional and Responsible AI acceptance criteria under normal, edge, adversarial and failure conditions.',
    process: ['Define test populations, scenarios, metrics, subgroup analysis and thresholds before execution.', 'Test accuracy, reliability, fairness, safety, security, privacy, explainability, accessibility and misuse resistance.', 'Conduct red-team and adversarial testing proportionate to risk.', 'Test human-AI interaction, reviewer performance and escalation.', 'Independently validate high-risk systems and document residual limitations.'],
    checklist: ['Acceptance criteria are approved before testing.', 'Evaluation data represents intended operating contexts.', 'Results are analyzed by relevant groups and worst-performing segments.', 'False positive and false negative impacts are understood.', 'Robustness, drift sensitivity, edge cases and out-of-distribution inputs are tested.', 'Safety-critical failure modes and fail-safe behavior are verified.', 'Prompt injection, data leakage and access-control bypass are tested where relevant.', 'Explanations are accurate, useful and appropriate to the audience.', 'Human reviewers can identify and correct erroneous outputs.', 'Severe findings are remediated or formally accepted by authorized owners.', 'Independent validation is completed where required.'],
    evidence: ['Evaluation and validation report', 'Fairness and subgroup assessment', 'Security, privacy and red-team reports', 'Accessibility and user testing', 'Defect, remediation and waiver log', 'Independent validation sign-off'],
    exit: 'All mandatory thresholds are met, severe defects are closed, and authorized parties accept documented residual risk.',
  },
  {
    n: 6, name: 'Deployment and go-live approval', short: 'Deploy', outcome: 'Release controls and user communication ready', gate: 'Go-live approval',
    objective: 'Release only when controls, user communications, monitoring, support, rollback and accountability are operational.',
    process: ['Confirm that the release matches the assessed purpose, population, model and data.', 'Complete privacy, security, legal, architecture and Responsible AI release reviews.', 'Implement notices, instructions, limitations, support and appeal routes.', 'Activate monitoring, alerts, audit logs, rollback and incident response.', 'Record the formal go-live decision and any time-bound conditions.'],
    checklist: ['Impact assessment and risk register are current.', 'Model, data and system documentation are complete.', 'Required evaluation thresholds are met.', 'Security, privacy, legal and accessibility approvals are recorded.', 'Users receive appropriate disclosure, instructions and limitations.', 'Human oversight is staffed and operational.', 'Monitoring dashboards and alerts are live.', 'Rollback, isolation and kill-switch procedures are tested.', 'Support and incident teams are trained.', 'Residual risk is accepted by the correct authority.', 'Approval status and production version are updated in the inventory.'],
    evidence: ['Go-live approval form', 'Final system or model card', 'Release test summary', 'Monitoring and incident plans', 'Transparency notice and user guidance', 'Residual-risk acceptance and conditions'],
    exit: 'Decision is recorded as Approved, Approved with conditions, or Returned for remediation.',
  },
  {
    n: 7, name: 'Production monitoring and periodic review', short: 'Monitor', outcome: 'Ongoing quality, fairness, safety and misuse detection', gate: 'Operational review',
    objective: 'Detect degradation, unfair outcomes, misuse, incidents and context changes throughout operation.',
    process: ['Monitor model quality, drift, fairness, safety, security, privacy, usage patterns and human overrides.', 'Review complaints, appeals, incidents and near misses for systemic issues.', 'Reassess vendor changes, new populations and contextual changes.', 'Report risk and outcome metrics to governance bodies.', 'Conduct periodic reapproval based on risk tier.'],
    checklist: ['Performance and fairness metrics have thresholds and owners.', 'Drift, harmful outputs and security signals trigger action.', 'Complaints, appeals and overrides are categorized and analyzed.', 'Monitoring includes lagging outcomes, not only technical proxies.', 'Vendor model or policy changes are assessed before material adoption.', 'Logs are retained and protected according to policy.', 'Impact assessment and documentation are refreshed on schedule.', 'High-risk systems receive independent periodic review.', 'Continued use is suspended when risk exceeds tolerance.'],
    evidence: ['Monitoring dashboard and reports', 'Complaint, appeal and override analysis', 'Periodic review and reapproval record', 'Updated risk register and impact assessment', 'Vendor change log'],
    exit: 'Continued operation remains within approved thresholds; exceptions and remediation are time-bound and governed.',
  },
  {
    n: 8, name: 'Change management', short: 'Change', outcome: 'Changes reassessed', gate: 'Change approval',
    objective: 'Reassess material changes before they alter approved risk, behavior, populations or operating context.',
    process: ['Log the proposed change and assess materiality.', 'Identify affected assessments, controls, tests, notices and approvals.', 'Perform regression and targeted Responsible AI testing.', 'Update inventory, system card, monitoring and rollback artifacts.', 'Obtain renewed approval when trigger criteria are met.'],
    checklist: ['Change purpose and expected effect are documented.', 'Model, data, prompt, retrieval, tool, geography, language, user and automation changes are considered.', 'Risk tier and impact assessment are refreshed where necessary.', 'Regression, fairness, safety and security testing are complete.', 'User notices and instructions remain accurate.', 'Previous configuration is recoverable.', 'Required approvers authorize release.'],
    evidence: ['Material-change assessment', 'Updated risk and impact assessments', 'Regression results', 'Updated system card and notices', 'Change approval and release record'],
    exit: 'Material change is approved before production activation and monitoring baselines are reset where necessary.',
  },
  {
    n: 9, name: 'AI incident management', short: 'Incident', outcome: 'Harm contained and corrected', gate: 'Closure and lessons learned',
    objective: 'Contain harmful behavior quickly, preserve evidence, remediate affected parties and prevent recurrence.',
    process: ['Detect, record and classify the event using AI-specific severity criteria.', 'Contain, disable, roll back or restrict the system as needed.', 'Identify affected users, decisions, data and downstream systems.', 'Notify accountable owners and evaluate contractual or regulatory notification.', 'Perform root-cause analysis, remediation, corrective action and lessons learned.'],
    checklist: ['A single reporting route and 24/7 escalation path exist where needed.', 'The system can be isolated or disabled quickly.', 'Relevant prompts, inputs, outputs, model versions and actions are traceable.', 'Affected decisions can be corrected or reversed where feasible.', 'Evidence is preserved appropriately.', 'Notification responsibilities and timelines are defined.', 'Affected parties receive appropriate communication and redress.', 'Root cause distinguishes model, data, design, human, process and vendor factors.', 'Risk assessments, controls and training are updated.', 'Closure is approved by the appropriate authority.'],
    evidence: ['AI incident record', 'Containment and notification log', 'Impact and affected-party analysis', 'Root-cause report', 'Corrective and preventive action plan', 'Closure approval and lessons learned'],
    exit: 'Incident is contained, affected parties are addressed, corrective actions are verified and governance approves closure.',
  },
  {
    n: 10, name: 'Retirement and decommissioning', short: 'Retire', outcome: 'Safe decommissioning and evidence preservation', gate: 'Retirement sign-off',
    objective: 'End use safely, remove access and dependencies, meet retention obligations and preserve necessary evidence.',
    process: ['Approve retirement scope, date, migration and stakeholder communication.', 'Disable integrations, credentials, endpoints, agents and scheduled jobs.', 'Archive or destroy models, data and logs according to policy.', 'Terminate vendor services and verify deletion or return obligations.', 'Update inventory and complete post-retirement review.'],
    checklist: ['Business owner approves retirement.', 'Users and downstream systems are informed.', 'Credentials, APIs and automations are disabled.', 'Records, data and model artifacts are retained or deleted appropriately.', 'Vendor exit and deletion evidence are obtained.', 'Open incidents, complaints and appeals are resolved or transferred.', 'Inventory status and ownership are updated.', 'Lessons learned are captured.'],
    evidence: ['Retirement approval', 'Decommissioning and dependency checklist', 'Data retention or deletion evidence', 'Vendor termination record', 'Final inventory update and lessons learned'],
    exit: 'Retirement is verified by the business and technical owners, and required evidence is preserved.',
  },
];
export const stageOf = (n) => STAGES[(n || 1) - 1];

// Gates where a high-risk product also needs the governance lead: the impact assessment, validation, go-live, and
// every change to a system already in production (a change can alter the approved risk as much as the first release).
export const GATE_STAGES = [2, 5, 6, 8];
export function requiredApprovals(stage, tier) {
  if (tier === 'unacceptable') return [];
  if (tier === 'high' && GATE_STAGES.includes(stage)) return ['assessor', 'lead'];
  return ['assessor'];
}

// After stage 6 the product runs in stage 7; changes (8) and incidents (9) return to 7; 10 retires it.
export function nextStage(stage) {
  if (stage <= 6) return stage + 1;
  if (stage === 8 || stage === 9) return 7;
  return stage;
}

export const STAGE_STATUS = { open: 'In progress', submitted: 'Awaiting review', returned: 'Returned', approved: 'Approved' };

export const DATASET_ROLES = ['Training', 'Inference input', 'Reference data', 'Knowledge base'];
export const CLASSIFICATIONS = ['Public', 'Internal', 'Confidential', 'Restricted'];
export const OUTPUT_TARGETS = [
  'Recommendation to a staff member',
  'Automated decision sent to a person',
  'Content or answers shown to customers',
  'Internal dashboard or report',
  'Downstream system or API',
];

// Stages grouped into phases for the lifecycle rail and the pipeline board.
export const PHASES = [
  { id: 'plan', name: 'Plan', stages: [1, 2] },
  { id: 'build', name: 'Build and validate', stages: [3, 4, 5, 6] },
  { id: 'operate', name: 'Operate', stages: [7, 8, 9] },
  { id: 'retire', name: 'Retire', stages: [10] },
];
export const phaseOf = (n) => PHASES.find((p) => p.stages.includes(n)) || PHASES[0];
// Stages 8 to 10 only start when something happens in production.
export const ON_DEMAND = [8, 9, 10];
