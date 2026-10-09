#!/bin/bash
set -euo pipefail

# 1) DLQ primeiro: a fila principal precisa do ARN dela
awslocal sqs create-queue \
  --queue-name wager-transactions-dlq.fifo \
  --attributes FifoQueue=true,ContentBasedDeduplication=false

DLQ_ARN=$(awslocal sqs get-queue-attributes \
  --queue-url "$(awslocal sqs get-queue-url --queue-name wager-transactions-dlq.fifo --query QueueUrl --output text)" \
  --attribute-names QueueArn --query Attributes.QueueArn --output text)

# 2) Fila principal: após 5 recebimentos sem delete, o SQS move para a DLQ
cat > /tmp/main-queue-attrs.json <<JSON
{
  "FifoQueue": "true",
  "ContentBasedDeduplication": "false",
  "VisibilityTimeout": "30",
  "RedrivePolicy": "{\"deadLetterTargetArn\":\"${DLQ_ARN}\",\"maxReceiveCount\":\"5\"}"
}
JSON
awslocal sqs create-queue \
  --queue-name wager-transactions.fifo \
  --attributes file:///tmp/main-queue-attrs.json

# 3) Fila de saída dos eventos de integração (publicados pela outbox)
awslocal sqs create-queue --queue-name wagering-events

echo "SQS queues ready"
awslocal sqs list-queues
