// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

// this file contains implementations of the C API

#include <cassert>

#include "ort_env.h"
#include "core/session/ort_apis.h"
#include "core/session/environment.h"
#include "core/session/allocator_adapters.h"
#include "core/session/user_logging_sink.h"
#include "core/common/logging/logging.h"
#include "core/framework/provider_shutdown.h"
#include "core/platform/logging/make_platform_default_log_sink.h"

using namespace onnxruntime;
using namespace onnxruntime::logging;

#ifdef USE_WEBGPU
namespace onnxruntime {
namespace webgpu {
void CleanupWebGpuContexts();
}  // namespace webgpu
}  // namespace onnxruntime
#endif

std::unique_ptr<OrtEnv> OrtEnv::p_instance_;
int OrtEnv::ref_count_ = 0;
std::mutex OrtEnv::m_;

OrtEnv::OrtEnv(std::unique_ptr<onnxruntime::Environment> value1)
    : value_(std::move(value1)) {
}

OrtEnv::~OrtEnv() {
#ifdef USE_WEBGPU
  webgpu::CleanupWebGpuContexts();
#endif

// We don't support any shared providers in the minimal build yet
#if !defined(ORT_MINIMAL_BUILD)
  UnloadSharedProviders();
#endif
}

OrtEnv* OrtEnv::GetInstance(const OrtEnv::LoggingManagerConstructionInfo& lm_info,
                            onnxruntime::common::Status& status,
                            const OrtThreadingOptions* tp_options) {
  std::lock_guard<std::mutex> lock(m_);
  if (!p_instance_) {
    std::unique_ptr<LoggingManager> lmgr;
    std::string name = lm_info.logid;

    std::unique_ptr<ISink> sink = nullptr;
    if (lm_info.logging_function) {
      sink = std::make_unique<UserLoggingSink>(lm_info.logging_function, lm_info.logger_param);

    } else {
      sink = MakePlatformDefaultLogSink();
    }
    auto etwOverrideSeverity = logging::OverrideLevelWithEtw(static_cast<Severity>(lm_info.default_warning_level));
    sink = EnhanceSinkWithEtw(std::move(sink), static_cast<Severity>(lm_info.default_warning_level),
                              etwOverrideSeverity);
    lmgr = std::make_unique<LoggingManager>(std::move(sink),
                                            std::min(static_cast<Severity>(lm_info.default_warning_level), etwOverrideSeverity),
                                            false,
                                            LoggingManager::InstanceType::Default,
                                            &name);

    std::unique_ptr<onnxruntime::Environment> env;
    if (!tp_options) {
      status = onnxruntime::Environment::Create(std::move(lmgr), env);
    } else {
      status = onnxruntime::Environment::Create(std::move(lmgr), env, tp_options, true);
    }
    if (!status.IsOK()) {
      return nullptr;
    }
    p_instance_ = std::make_unique<OrtEnv>(std::move(env));
  }

  ++ref_count_;
  return p_instance_.get();
}

void OrtEnv::Release(OrtEnv* env_ptr) {
  if (!env_ptr) {
    return;
  }
  std::lock_guard<std::mutex> lock(m_);
  ORT_ENFORCE(env_ptr == p_instance_.get());  // sanity check
  --ref_count_;
  if (ref_count_ == 0) {
    p_instance_.reset();
  }
}

onnxruntime::logging::LoggingManager* OrtEnv::GetLoggingManager() const {
  return value_->GetLoggingManager();
}

void OrtEnv::SetLoggingManager(std::unique_ptr<onnxruntime::logging::LoggingManager> logging_manager) {
  value_->SetLoggingManager(std::move(logging_manager));
}

onnxruntime::common::Status OrtEnv::RegisterAllocator(AllocatorPtr allocator) {
  auto status = value_->RegisterAllocator(allocator);
  return status;
}

onnxruntime::common::Status OrtEnv::CreateAndRegisterAllocator(const OrtMemoryInfo& mem_info,
                                                               const OrtArenaCfg* arena_cfg) {
  auto status = value_->CreateAndRegisterAllocator(mem_info, arena_cfg);
  return status;
}

onnxruntime::common::Status OrtEnv::UnregisterAllocator(const OrtMemoryInfo& mem_info) {
  return value_->UnregisterAllocator(mem_info);
}

onnxruntime::common::Status OrtEnv::CreateAndRegisterAllocatorV2(const std::string& provider_type, const OrtMemoryInfo& mem_info, const std::unordered_map<std::string, std::string>& options, const OrtArenaCfg* arena_cfg) {
  return value_->CreateAndRegisterAllocatorV2(provider_type, mem_info, options, arena_cfg);
}
