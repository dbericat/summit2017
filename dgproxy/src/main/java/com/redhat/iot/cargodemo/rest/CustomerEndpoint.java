package com.redhat.iot.cargodemo.rest;/*
 * JBoss, Home of Professional Open Source
 * Copyright 2015, Red Hat, Inc. and/or its affiliates, and individual
 * contributors by the @authors tag. See the copyright.txt in the
 * distribution for a full listing of individual contributors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 * http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import com.redhat.iot.cargodemo.model.Customer;
import com.redhat.iot.cargodemo.service.DGService;

import javax.inject.Inject;
import javax.inject.Singleton;
import javax.ws.rs.*;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * A simple REST service which proxies requests to a local datagrid.
 *
 * @author jfalkner@redhat.com
 */

@Path("/customer")
@Singleton
public class CustomerEndpoint {

    @Inject
    DGService dgService;

    @GET
    @Path("/{id}")
    @Produces({"application/json"})
    public Customer getCustomer(@PathParam("id") String id) {
        return dgService.getCustomers().get(id);
    }

    @PUT
    @Path("/{id}")
    public void putCustomer(@PathParam("id") String id, Customer value) {
        dgService.getCustomers().put(id, value);
    }

    @GET
    @Path("/")
    @Produces({"application/json"})
    public List<Customer> getAllCustomers() {

        Map<String, Customer> cache = dgService.getCustomers();

        return cache.keySet().stream()
            .map(cache::get)
            .collect(Collectors.toList());

    }

}

