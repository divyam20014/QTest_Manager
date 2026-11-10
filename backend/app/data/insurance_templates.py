"""Tier 5 (PV-10.1): Insurance QA Pack -- a small, generic template library
for common P&C insurance QA scenarios (claims, underwriting, policy admin).
Entirely static, in-code data: no customer/claims data, no DB table of its
own. Each template becomes a real TestCase on import, organized into a
Module named after its category (auto-created the first time a tenant
imports into a given category)."""

from dataclasses import dataclass

from app.core.errors import ValidationAppError


@dataclass(frozen=True)
class InsuranceTemplate:
    id: str
    category: str
    title: str
    description: str
    priority: str
    steps: list[tuple[str, str]]


INSURANCE_TEMPLATES: list[InsuranceTemplate] = [
    # --- Claims ---------------------------------------------------------
    InsuranceTemplate(
        id="claims-fnol-intake",
        category="Claims",
        title="Verify First Notice of Loss (FNOL) intake creates a claim record",
        description=(
            "Confirm that submitting a First Notice of Loss creates a claim with the "
            "correct policy linkage and status."
        ),
        priority="High",
        steps=[
            (
                "Submit a new FNOL referencing an active policy number",
                "A claim record is created and linked to the policy",
            ),
            (
                "Open the newly created claim",
                "Claim status is 'Open - Under Review' and loss date matches the FNOL submission",
            ),
        ],
    ),
    InsuranceTemplate(
        id="claims-coverage-verification",
        category="Claims",
        title="Verify coverage check runs automatically on claim creation",
        description=(
            "Confirm a claim is automatically checked against the policy's "
            "coverage terms and limits."
        ),
        priority="High",
        steps=[
            (
                "Create a claim for a loss type covered by the policy",
                "Coverage check passes and claim proceeds to adjudication",
            ),
            (
                "Create a claim for a loss type excluded by the policy",
                "Coverage check flags the claim as 'Coverage Question' and routes it for "
                "manual review",
            ),
        ],
    ),
    InsuranceTemplate(
        id="claims-adjudication-approval",
        category="Claims",
        title="Verify adjuster approval moves a claim to payout-ready",
        description="Confirm that an adjuster's approval decision transitions a claim correctly.",
        priority="Critical",
        steps=[
            (
                "As an adjuster, review a claim and approve the assessed loss amount",
                "Claim status changes to 'Approved - Pending Payment'",
            ),
            (
                "Attempt to approve the same claim twice",
                "System rejects the duplicate approval with a clear error",
            ),
        ],
    ),
    InsuranceTemplate(
        id="claims-payout-calculation",
        category="Claims",
        title="Verify payout calculation applies deductible correctly",
        description="Confirm the payout amount equals assessed loss minus the policy deductible.",
        priority="Critical",
        steps=[
            (
                "Approve a claim with assessed loss of $5,000 and a $500 deductible",
                "Payout amount calculates to $4,500",
            ),
            (
                "Approve a claim where assessed loss is less than the deductible",
                "Payout amount calculates to $0, not a negative value",
            ),
        ],
    ),
    InsuranceTemplate(
        id="claims-denial-reason-code",
        category="Claims",
        title="Verify a denied claim requires a reason code",
        description="Confirm that denying a claim is blocked without a documented denial reason.",
        priority="Medium",
        steps=[
            (
                "Attempt to deny a claim without selecting a reason code",
                "System blocks the denial and prompts for a reason code",
            ),
            (
                "Deny the claim with a valid reason code selected",
                "Claim status changes to 'Denied' and the reason is recorded on the claim history",
            ),
        ],
    ),
    InsuranceTemplate(
        id="claims-status-notification",
        category="Claims",
        title="Verify claimant is notified on each status change",
        description=(
            "Confirm a notification is sent to the claimant whenever " "claim status changes."
        ),
        priority="Medium",
        steps=[
            (
                "Change a claim's status from 'Open' to 'Approved'",
                "The claimant receives a status-change notification referencing the claim number",
            ),
        ],
    ),
    # --- Underwriting ----------------------------------------------------
    InsuranceTemplate(
        id="underwriting-risk-assessment",
        category="Underwriting",
        title="Verify risk score is calculated for a new application",
        description="Confirm that submitting a new policy application triggers a risk assessment.",
        priority="High",
        steps=[
            (
                "Submit a new policy application with complete risk-factor data",
                "A risk score is calculated and attached to the application",
            ),
            (
                "Submit an application with missing required risk-factor fields",
                "Application is blocked from risk scoring until required fields are completed",
            ),
        ],
    ),
    InsuranceTemplate(
        id="underwriting-rating-tier",
        category="Underwriting",
        title="Verify premium rating tier matches the calculated risk score",
        description=(
            "Confirm the quoted premium reflects the correct rating tier for "
            "the applicant's risk score."
        ),
        priority="High",
        steps=[
            (
                "Generate a quote for an application with a low risk score",
                "Quote uses the preferred rating tier and lowest applicable rate",
            ),
            (
                "Generate a quote for an application with a high risk score",
                "Quote uses a higher rating tier with the correspondingly higher rate",
            ),
        ],
    ),
    InsuranceTemplate(
        id="underwriting-policy-issuance",
        category="Underwriting",
        title="Verify policy issuance requires underwriting approval",
        description=(
            "Confirm a policy cannot be issued until underwriting has "
            "formally approved the application."
        ),
        priority="Critical",
        steps=[
            (
                "Attempt to issue a policy for an application still pending underwriting review",
                "System blocks issuance and shows the pending-review status",
            ),
            (
                "Issue the policy after underwriting approval is recorded",
                "Policy is issued with an effective date and policy number",
            ),
        ],
    ),
    InsuranceTemplate(
        id="underwriting-referral-threshold",
        category="Underwriting",
        title="Verify high-risk applications are referred to a senior underwriter",
        description=(
            "Confirm applications above the automated approval threshold are "
            "routed for manual referral."
        ),
        priority="Medium",
        steps=[
            (
                "Submit an application with a risk score above the automated-approval threshold",
                "Application is flagged 'Referred' and routed to a senior underwriter queue",
            ),
        ],
    ),
    InsuranceTemplate(
        id="underwriting-decline-reason",
        category="Underwriting",
        title="Verify a declined application records a decline reason",
        description="Confirm declining an application requires and stores a documented reason.",
        priority="Medium",
        steps=[
            (
                "Decline an application without selecting a decline reason",
                "System blocks the decline and requires a reason to be selected",
            ),
            (
                "Decline the application with a valid reason selected",
                "Application status changes to 'Declined' with the reason visible in its history",
            ),
        ],
    ),
    # --- Policy Administration -------------------------------------------
    InsuranceTemplate(
        id="policyadmin-endorsement-premium-change",
        category="Policy Admin",
        title="Verify a mid-term endorsement recalculates premium pro-rata",
        description=(
            "Confirm adding a mid-term endorsement adjusts premium for the "
            "remaining policy period only."
        ),
        priority="High",
        steps=[
            (
                "Add a coverage endorsement to a policy mid-term",
                "Additional premium is calculated pro-rata for the remaining term, "
                "not the full annual premium",
            ),
        ],
    ),
    InsuranceTemplate(
        id="policyadmin-renewal-generation",
        category="Policy Admin",
        title="Verify renewal offer is generated before policy expiration",
        description=(
            "Confirm the system automatically generates a renewal offer ahead of "
            "the policy's expiration date."
        ),
        priority="High",
        steps=[
            (
                "Advance a policy to within the renewal-notice window of its expiration date",
                "A renewal offer is generated and the policyholder is notified",
            ),
            (
                "Verify a renewed policy's effective date immediately follows the "
                "expiring term with no coverage gap",
                "New term's effective date equals the prior term's expiration date",
            ),
        ],
    ),
    InsuranceTemplate(
        id="policyadmin-cancellation-refund",
        category="Policy Admin",
        title="Verify mid-term cancellation calculates a pro-rata refund",
        description=(
            "Confirm cancelling a policy mid-term calculates the correct "
            "unearned premium refund."
        ),
        priority="Critical",
        steps=[
            (
                "Cancel a policy 90 days into a 365-day annual term",
                "Refund equals the unearned premium for the remaining 275 days, pro-rata",
            ),
            (
                "Cancel a policy for non-payment",
                "No refund is issued and the cancellation reason records 'non-payment'",
            ),
        ],
    ),
    InsuranceTemplate(
        id="policyadmin-reinstatement-window",
        category="Policy Admin",
        title="Verify a lapsed policy can only be reinstated within the grace period",
        description=(
            "Confirm reinstatement of a lapsed policy is blocked once the "
            "grace period has passed."
        ),
        priority="Medium",
        steps=[
            (
                "Reinstate a policy that lapsed within the grace period, with payment",
                "Policy is reinstated with no coverage gap",
            ),
            (
                "Attempt to reinstate a policy that lapsed beyond the grace period",
                "System blocks reinstatement and requires a new application",
            ),
        ],
    ),
    InsuranceTemplate(
        id="policyadmin-named-insured-change",
        category="Policy Admin",
        title="Verify adding a named insured requires updated risk information",
        description=(
            "Confirm adding a named insured to an active policy triggers collection of their "
            "risk information before the change is effective."
        ),
        priority="Medium",
        steps=[
            (
                "Request to add a named insured without providing their risk information",
                "System blocks the endorsement until risk information is supplied",
            ),
            (
                "Submit the endorsement with complete risk information",
                "Named insured is added effective the endorsement date",
            ),
        ],
    ),
]


def list_templates() -> list[InsuranceTemplate]:
    return list(INSURANCE_TEMPLATES)


def get_templates_by_ids(ids: list[str]) -> list[InsuranceTemplate]:
    by_id = {t.id: t for t in INSURANCE_TEMPLATES}
    missing = [i for i in ids if i not in by_id]
    if missing:
        raise ValidationAppError(f"Unknown template id(s): {', '.join(missing)}")
    return [by_id[i] for i in ids]
