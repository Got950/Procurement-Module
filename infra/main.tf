# Staging/prod Terraform for Pharma Procurement (PLAN B-49).
# NOT applied by CI. Review variables, then `terraform plan` / `apply` in your account.
#
# Cost-conscious defaults:
# - enable_nat=false → public-subnet tasks (no NAT Gateway ~$32+/mo)
# - staging: 1 web task, db.t4g.small; prod: 2 web tasks, db.t4g.medium, Multi-AZ
# Set enable_nat=true for private-subnet egress to Gmail/OpenAI without public task IPs.

terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

variable "aws_region" { default = "us-east-1" }
variable "app_name" { default = "pharma-procurement" }
variable "environment" { default = "staging" }
variable "db_password" {
  type      = string
  sensitive = true
}
variable "enable_nat" {
  type        = bool
  default     = false
  description = "NAT Gateway for private-subnet egress (Gmail/OpenAI). Default off for cost; enable for prod private tasks."
}
variable "image_tag" { default = "latest" }
variable "certificate_arn" {
  type    = string
  default = ""
  description = "ACM cert ARN for HTTPS listener. Empty = HTTP only (lab/staging). Set for production TLS."
}
variable "web_desired_count" {
  type        = number
  default     = 0
  description = "0 = auto (staging 1, prod 2)."
}
variable "db_instance_class" {
  type        = string
  default     = ""
  description = "Empty = db.t4g.small (staging) or db.t4g.medium (prod)."
}

provider "aws" {
  region = var.aws_region
}

data "aws_availability_zones" "available" {
  state = "available"
}

locals {
  name              = "${var.app_name}-${var.environment}"
  azs               = slice(data.aws_availability_zones.available.names, 0, 2)
  is_prod           = var.environment == "prod"
  web_desired_count = var.web_desired_count > 0 ? var.web_desired_count : (local.is_prod ? 2 : 1)
  db_instance_class = var.db_instance_class != "" ? var.db_instance_class : (local.is_prod ? "db.t4g.medium" : "db.t4g.small")
  use_https         = var.certificate_arn != ""
}

resource "aws_vpc" "main" {
  cidr_block           = "10.40.0.0/16"
  enable_dns_hostnames = true
  tags                 = { Name = local.name }
}

resource "aws_internet_gateway" "igw" {
  vpc_id = aws_vpc.main.id
}

resource "aws_subnet" "public" {
  count                   = 2
  vpc_id                  = aws_vpc.main.id
  cidr_block              = cidrsubnet(aws_vpc.main.cidr_block, 4, count.index)
  availability_zone       = local.azs[count.index]
  map_public_ip_on_launch = true
  tags                    = { Name = "${local.name}-public-${count.index}" }
}

resource "aws_subnet" "private" {
  count             = 2
  vpc_id            = aws_vpc.main.id
  cidr_block        = cidrsubnet(aws_vpc.main.cidr_block, 4, count.index + 2)
  availability_zone = local.azs[count.index]
  tags              = { Name = "${local.name}-private-${count.index}" }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.igw.id
  }
}

resource "aws_route_table_association" "public" {
  count          = 2
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

resource "aws_eip" "nat" {
  count  = var.enable_nat ? 1 : 0
  domain = "vpc"
}

resource "aws_nat_gateway" "nat" {
  count         = var.enable_nat ? 1 : 0
  allocation_id = aws_eip.nat[0].id
  subnet_id     = aws_subnet.public[0].id
}

resource "aws_route_table" "private" {
  count  = 2
  vpc_id = aws_vpc.main.id
  dynamic "route" {
    for_each = var.enable_nat ? [1] : []
    content {
      cidr_block     = "0.0.0.0/0"
      nat_gateway_id = aws_nat_gateway.nat[0].id
    }
  }
}

resource "aws_route_table_association" "private" {
  count          = 2
  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private[count.index].id
}

resource "aws_security_group" "alb" {
  name   = "${local.name}-alb"
  vpc_id = aws_vpc.main.id
  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group" "ecs" {
  name   = "${local.name}-ecs"
  vpc_id = aws_vpc.main.id
  ingress {
    from_port       = 3000
    to_port         = 3000
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group" "rds" {
  name   = "${local.name}-rds"
  vpc_id = aws_vpc.main.id
  ingress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.ecs.id]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_db_subnet_group" "db" {
  name       = "${local.name}-db"
  subnet_ids = aws_subnet.private[*].id
}

resource "aws_db_instance" "postgres" {
  identifier                 = "${local.name}-pg"
  engine                     = "postgres"
  engine_version             = "16"
  instance_class             = local.db_instance_class
  allocated_storage          = local.is_prod ? 50 : 20
  max_allocated_storage      = local.is_prod ? 100 : 50
  storage_encrypted          = true
  db_name                    = "pharma_procurement"
  username                   = "procurement"
  password                   = var.db_password
  db_subnet_group_name       = aws_db_subnet_group.db.name
  vpc_security_group_ids     = [aws_security_group.rds.id]
  multi_az                   = local.is_prod
  publicly_accessible        = false
  skip_final_snapshot        = !local.is_prod
  backup_retention_period    = local.is_prod ? 7 : 1
  deletion_protection        = local.is_prod
  auto_minor_version_upgrade = true
}

resource "aws_s3_bucket" "documents" {
  bucket = "${local.name}-documents"
}

resource "aws_s3_bucket_public_access_block" "documents" {
  bucket                  = aws_s3_bucket.documents.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "documents" {
  bucket = aws_s3_bucket.documents.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_versioning" "documents" {
  bucket = aws_s3_bucket.documents.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_lifecycle_configuration" "documents" {
  bucket = aws_s3_bucket.documents.id
  rule {
    id     = "abort-incomplete-multipart"
    status = "Enabled"
    filter {}
    abort_incomplete_multipart_upload { days_after_initiation = 7 }
  }
  rule {
    id     = "expire-noncurrent-versions"
    status = "Enabled"
    filter {}
    noncurrent_version_expiration { noncurrent_days = 90 }
  }
}

resource "aws_vpc_endpoint" "s3" {
  vpc_id            = aws_vpc.main.id
  service_name      = "com.amazonaws.${var.aws_region}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = concat([aws_route_table.public.id], aws_route_table.private[*].id)
}

resource "aws_ecr_repository" "app" {
  name                 = local.name
  image_tag_mutability = "MUTABLE"
  image_scanning_configuration { scan_on_push = true }
}

resource "aws_cloudwatch_log_group" "app" {
  name              = "/ecs/${local.name}"
  retention_in_days = 14
}

resource "aws_secretsmanager_secret" "app" {
  name = "${local.name}-app"
  # Operator must put a JSON secret version with keys used by task definitions:
  # DATABASE_URL, SESSION_SECRET, GMAIL_TOKEN_SECRET, OPENAI_API_KEY,
  # GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REDIRECT_URI, APP_URL
  # Optional: GMAIL_TOKEN_SALT, OPENAI_MODEL, OPENAI_COPILOT_MODEL
}

resource "aws_iam_role" "ecs_execution" {
  name = "${local.name}-ecs-exec"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "ecs_execution" {
  role       = aws_iam_role.ecs_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# ECS injects secrets via the execution role (not the task role).
resource "aws_iam_role_policy" "ecs_execution_secrets" {
  name = "${local.name}-ecs-exec-secrets"
  role = aws_iam_role.ecs_execution.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["secretsmanager:GetSecretValue"]
      Resource = [aws_secretsmanager_secret.app.arn]
    }]
  })
}

resource "aws_iam_role" "ecs_task" {
  name = "${local.name}-ecs-task"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy" "ecs_task" {
  name = "${local.name}-task"
  role = aws_iam_role.ecs_task.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
        Resource = ["${aws_s3_bucket.documents.arn}/*"]
      },
      {
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
        Resource = [aws_s3_bucket.documents.arn]
      },
      {
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = [aws_secretsmanager_secret.app.arn]
      }
    ]
  })
}

resource "aws_ecs_cluster" "main" {
  name = local.name
}

resource "aws_lb" "app" {
  name               = substr(local.name, 0, 32)
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = aws_subnet.public[*].id
}

resource "aws_lb_target_group" "web" {
  name        = substr("${local.name}-web", 0, 32)
  port        = 3000
  protocol    = "HTTP"
  vpc_id      = aws_vpc.main.id
  target_type = "ip"
  health_check {
    path                = "/api/health/ready"
    healthy_threshold   = 2
    unhealthy_threshold = 3
    interval            = 30
    timeout             = 5
    matcher             = "200"
  }
}

resource "aws_lb_listener" "http_forward" {
  count             = local.use_https ? 0 : 1
  load_balancer_arn = aws_lb.app.arn
  port              = 80
  protocol          = "HTTP"
  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.web.arn
  }
}

resource "aws_lb_listener" "http_redirect" {
  count             = local.use_https ? 1 : 0
  load_balancer_arn = aws_lb.app.arn
  port              = 80
  protocol          = "HTTP"
  default_action {
    type = "redirect"
    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }
}

resource "aws_lb_listener" "https" {
  count             = local.use_https ? 1 : 0
  load_balancer_arn = aws_lb.app.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.certificate_arn
  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.web.arn
  }
}

resource "aws_ecs_task_definition" "web" {
  family                   = "${local.name}-web"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = "512"
  memory                   = "1024"
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn
  container_definitions = jsonencode([{
    name      = "web"
    image     = "${aws_ecr_repository.app.repository_url}:${var.image_tag}"
    essential = true
    portMappings = [{ containerPort = 3000, protocol = "tcp" }]
    environment = [
      { name = "NODE_ENV", value = "production" },
      { name = "S3_BUCKET", value = aws_s3_bucket.documents.bucket },
      { name = "AWS_REGION", value = var.aws_region },
      { name = "DATABASE_POOL_MAX", value = "5" },
      { name = "FORCE_SECURE_COOKIES", value = local.use_https ? "1" : "0" },
      { name = "EMIT_EMF", value = "1" }
    ]
    secrets = [
      { name = "DATABASE_URL", valueFrom = "${aws_secretsmanager_secret.app.arn}:DATABASE_URL::" },
      { name = "SESSION_SECRET", valueFrom = "${aws_secretsmanager_secret.app.arn}:SESSION_SECRET::" },
      { name = "GMAIL_TOKEN_SECRET", valueFrom = "${aws_secretsmanager_secret.app.arn}:GMAIL_TOKEN_SECRET::" },
      { name = "OPENAI_API_KEY", valueFrom = "${aws_secretsmanager_secret.app.arn}:OPENAI_API_KEY::" },
      { name = "GMAIL_CLIENT_ID", valueFrom = "${aws_secretsmanager_secret.app.arn}:GMAIL_CLIENT_ID::" },
      { name = "GMAIL_CLIENT_SECRET", valueFrom = "${aws_secretsmanager_secret.app.arn}:GMAIL_CLIENT_SECRET::" },
      { name = "GMAIL_REDIRECT_URI", valueFrom = "${aws_secretsmanager_secret.app.arn}:GMAIL_REDIRECT_URI::" },
      { name = "APP_URL", valueFrom = "${aws_secretsmanager_secret.app.arn}:APP_URL::" }
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.app.name
        awslogs-region        = var.aws_region
        awslogs-stream-prefix = "web"
      }
    }
    healthCheck = {
      # Matches Dockerfile HEALTHCHECK — node alpine has no wget by default.
      command     = ["CMD-SHELL", "node -e \"fetch('http://127.0.0.1:3000/api/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))\""]
      interval    = 30
      timeout     = 5
      retries     = 3
      startPeriod = 40
    }
  }])
}

resource "aws_ecs_task_definition" "worker" {
  family                   = "${local.name}-worker"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = "256"
  memory                   = "512"
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn
  container_definitions = jsonencode([{
    name      = "worker"
    image     = "${aws_ecr_repository.app.repository_url}:${var.image_tag}"
    essential = true
    environment = [
      { name = "NODE_ENV", value = "production" },
      { name = "ROLE", value = "worker" },
      { name = "S3_BUCKET", value = aws_s3_bucket.documents.bucket },
      { name = "AWS_REGION", value = var.aws_region },
      { name = "DATABASE_POOL_MAX", value = "3" },
      { name = "EMIT_EMF", value = "1" }
    ]
    secrets = [
      { name = "DATABASE_URL", valueFrom = "${aws_secretsmanager_secret.app.arn}:DATABASE_URL::" },
      { name = "SESSION_SECRET", valueFrom = "${aws_secretsmanager_secret.app.arn}:SESSION_SECRET::" },
      { name = "GMAIL_TOKEN_SECRET", valueFrom = "${aws_secretsmanager_secret.app.arn}:GMAIL_TOKEN_SECRET::" },
      { name = "OPENAI_API_KEY", valueFrom = "${aws_secretsmanager_secret.app.arn}:OPENAI_API_KEY::" },
      { name = "GMAIL_CLIENT_ID", valueFrom = "${aws_secretsmanager_secret.app.arn}:GMAIL_CLIENT_ID::" },
      { name = "GMAIL_CLIENT_SECRET", valueFrom = "${aws_secretsmanager_secret.app.arn}:GMAIL_CLIENT_SECRET::" },
      { name = "GMAIL_REDIRECT_URI", valueFrom = "${aws_secretsmanager_secret.app.arn}:GMAIL_REDIRECT_URI::" },
      { name = "APP_URL", valueFrom = "${aws_secretsmanager_secret.app.arn}:APP_URL::" }
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.app.name
        awslogs-region        = var.aws_region
        awslogs-stream-prefix = "worker"
      }
    }
  }])
}

resource "aws_ecs_service" "web" {
  name            = "${local.name}-web"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.web.arn
  desired_count   = local.web_desired_count
  launch_type     = "FARGATE"
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }
  network_configuration {
    subnets          = var.enable_nat ? aws_subnet.private[*].id : aws_subnet.public[*].id
    security_groups  = [aws_security_group.ecs.id]
    assign_public_ip = !var.enable_nat
  }
  load_balancer {
    target_group_arn = aws_lb_target_group.web.arn
    container_name   = "web"
    container_port   = 3000
  }
  depends_on = [aws_lb_listener.http_forward, aws_lb_listener.http_redirect, aws_lb_listener.https]
}

resource "aws_ecs_service" "worker" {
  name            = "${local.name}-worker"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.worker.arn
  desired_count   = 1
  launch_type     = "FARGATE"
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }
  network_configuration {
    subnets          = var.enable_nat ? aws_subnet.private[*].id : aws_subnet.public[*].id
    security_groups  = [aws_security_group.ecs.id]
    assign_public_ip = !var.enable_nat
  }
}

resource "aws_wafv2_web_acl" "alb" {
  name  = "${local.name}-waf"
  scope = "REGIONAL"
  default_action { allow {} }
  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "${local.name}-waf"
    sampled_requests_enabled   = true
  }
  rule {
    name     = "AWSManagedRulesCommonRuleSet"
    priority = 1
    override_action { none {} }
    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesCommonRuleSet"
        vendor_name = "AWS"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "common"
      sampled_requests_enabled   = true
    }
  }
}

resource "aws_wafv2_web_acl_association" "alb" {
  resource_arn = aws_lb.app.arn
  web_acl_arn  = aws_wafv2_web_acl.alb.arn
}

output "alb_dns" { value = aws_lb.app.dns_name }
output "ecr_url" { value = aws_ecr_repository.app.repository_url }
output "documents_bucket" { value = aws_s3_bucket.documents.bucket }
output "rds_endpoint" { value = aws_db_instance.postgres.address }
output "secrets_arn" { value = aws_secretsmanager_secret.app.arn }
