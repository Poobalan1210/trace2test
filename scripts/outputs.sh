#!/usr/bin/env bash
# Prints one CloudFormation stack output. Usage: scripts/outputs.sh <OutputKey>
set -euo pipefail
STACK_NAME="${STACK_NAME:-trace2test}"
aws cloudformation describe-stacks --stack-name "$STACK_NAME" \
  --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text
