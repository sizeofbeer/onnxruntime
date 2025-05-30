// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

#pragma once

#include <vector>

#include "core/common/basic_types.h"
#include "core/common/inlined_containers_fwd.h"
#include "core/framework/allocator.h"
#include "core/framework/tensor_shape.h"

namespace onnxruntime {

struct PrePackedWeights final {
  // Some weights may be associated with multiple pre-packed buffers (e.g.) QLinearConv.
  // Hence we hold them in container. It is upto the developer implementing each PrePack()
  // method to define what gets stored in which position of the container.

  InlinedVector<IAllocatorUniquePtr<void>> buffers_;  // cache pre-packed buffers associated with the kernel
  InlinedVector<size_t> buffer_sizes_;                // cache sizes of pre-packed buffers (in bytes)

  // Produces a hash of the buffers stored in the given instance of this class
  HashValue GetHash() const;

  // The function creates a copy with non-owning BufferUniquePtrs.
  PrePackedWeights CreateReferringCopy() const;
};

}  // namespace onnxruntime
